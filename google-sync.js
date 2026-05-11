const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { app, shell, dialog } = require('electron');
const serverDestroy = require('server-destroy');

// --- CREDENTIALS (INJECTED AT BUILD TIME) ---
// These placeholders are automatically replaced by GitHub Actions during the build process
const CLIENT_ID = 'INJECT_CLIENT_ID_HERE';
const CLIENT_SECRET = 'INJECT_CLIENT_SECRET_HERE';
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

const SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/userinfo.email'
];
const LIST_TITLE = 'Glyph Sync';

class GoogleSync {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    this.tasksApi = google.tasks({ version: 'v1', auth: this.oauth2Client });
    this.oauth2Api = google.oauth2({ version: 'v2', auth: this.oauth2Client });
    this.taskListId = null;
    this.configPath = null;
    this.tokenPath = null;
    this.dataPath = null;
    this.syncInterval = null;
    this.onDataUpdated = null; // Callback for when pull updates local data
    this.pushQueue = Promise.resolve();
  }

  initPaths() {
    this.configPath = path.join(app.getPath('userData'), 'config.json');
    this.tokenPath = path.join(app.getPath('userData'), 'google-tokens.json');
    this.dataPath = path.join(app.getPath('userData'), 'data.json');
  }

  // Load tokens from file
  loadTokens() {
    if (fs.existsSync(this.tokenPath)) {
       try {
         const tokens = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8'));
         if (tokens && tokens.access_token) {
           this.oauth2Client.setCredentials(tokens);
           return true;
         }
       } catch(e) {
         console.error("Failed to parse tokens", e);
       }
    }
    return false;
  }

  // Authenticate (opens browser)
  async authenticate() {
    if (CLIENT_ID === 'YOUR_GOOGLE_CLIENT_ID') {
      throw new Error("Please set your Google Client ID and Secret in google-sync.js");
    }

    return new Promise((resolve, reject) => {
      const authorizeUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent' // Force to get refresh token
      });

      const server = http.createServer(async (req, res) => {
        try {
          if (req.url.indexOf('/oauth2callback') > -1) {
            const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><head><script>window.close();</script></head><body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #111; color: #fff;"><h2>Authentication successful! You can safely close this tab and return to Glyph.</h2></body></html>');
            server.destroy();

            const { tokens } = await this.oauth2Client.getToken(qs.get('code'));
            this.oauth2Client.setCredentials(tokens);

            // Save tokens to dedicated file
            fs.writeFileSync(this.tokenPath, JSON.stringify(tokens, null, 2));

            await this.initTaskList();
            this.startAutoSync();
            resolve(tokens);
          }
        } catch (e) {
          reject(e);
        }
      });

      serverDestroy(server);

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          const msg = "Port 3000 is already in use by another application. Please close it and try again.";
          dialog.showErrorBox("Google Sync Error", msg);
          reject(new Error(msg));
        } else {
          dialog.showErrorBox("Google Sync Error", err.message);
          reject(err);
        }
      });

      server.listen(3000, () => {
        shell.openExternal(authorizeUrl).catch(err => {
          dialog.showErrorBox("Browser Error", "Failed to open browser: " + err.message + "\nURL: " + authorizeUrl);
          reject(err);
        });
      });
      
      // Auto reject after 2 minutes if no login happens
      setTimeout(() => {
        reject(new Error("Authentication timed out after 2 minutes."));
      }, 120000);
    });
  }

  async logout() {
    this.stopAutoSync();
    try { await this.oauth2Client.revokeCredentials(); } catch(e){}
    this.oauth2Client.setCredentials(null);
    if (fs.existsSync(this.tokenPath)) {
      fs.unlinkSync(this.tokenPath);
    }
  }

  isAuthenticated() {
    return !!this.oauth2Client.credentials && !!this.oauth2Client.credentials.access_token;
  }

  async getUserEmail() {
    if (!this.isAuthenticated()) return null;
    try {
      const res = await this.oauth2Api.userinfo.get();
      return res.data.email;
    } catch (e) {
      console.error("Failed to get user email", e);
      return null;
    }
  }

  async initTaskList() {
    if (!this.isAuthenticated()) return;
    try {
      const res = await this.tasksApi.tasklists.list();
      const lists = res.data.items || [];
      let list = lists.find(l => l.title === LIST_TITLE);
      if (!list) {
        const createRes = await this.tasksApi.tasklists.insert({
          requestBody: { title: LIST_TITLE }
        });
        list = createRes.data;
      }
      this.taskListId = list.id;
    } catch (e) {
      console.error("Failed to init task list", e);
    }
  }

  startAutoSync() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    // Pull every 30 seconds for much faster Google -> App syncing
    this.syncInterval = setInterval(() => this.pull(), 30 * 1000);
    // Do an initial pull right away
    this.pull();
  }

  stopAutoSync() {
    if (this.syncInterval) clearInterval(this.syncInterval);
  }

  // Generate a due date formatted string for Google Tasks (RFC 3339)
  formatDateForGoogle(dateStr) {
    return new Date(dateStr + 'T12:00:00Z').toISOString();
  }

  // Sync a specific day up to Google Tasks
  async requestPush(dateStr) {
    if (!this.isAuthenticated() || !this.taskListId) return false;

    return new Promise((resolve) => {
      this.pushQueue = this.pushQueue.then(async () => {
        let modified = false;
        const due = this.formatDateForGoogle(dateStr);

        let data = {};
        if (fs.existsSync(this.dataPath)) {
          data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
        }
        const todos = data[dateStr] ? data[dateStr].todos : null;
        if (!todos) return resolve(false);

        for (let i = 0; i < todos.length; i++) {
          const t = todos[i];
          if (!t.text.trim()) continue;
          
          const status = t.done ? 'completed' : 'needsAction';
          
          try {
            if (!t.googleTaskId) {
              const res = await this.tasksApi.tasks.insert({
                tasklist: this.taskListId,
                requestBody: { title: t.text, due: due, status: status }
              });
              todos[i].googleTaskId = res.data.id;
              modified = true;
            } else {
              await this.tasksApi.tasks.update({
                tasklist: this.taskListId,
                task: t.googleTaskId,
                requestBody: { id: t.googleTaskId, title: t.text, due: due, status: status }
              });
            }
          } catch (e) {
            console.error(`Failed to push task ${t.text}`, e);
            if (e.code === 404) {
              delete todos[i].googleTaskId;
              modified = true;
            }
          }
        }
        
        if (modified) {
           const freshData = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
           if (freshData[dateStr] && freshData[dateStr].todos) {
              freshData[dateStr].todos.forEach(t => {
                 const synced = todos.find(ct => ct.id === t.id);
                 if (synced && synced.googleTaskId) t.googleTaskId = synced.googleTaskId;
              });
              fs.writeFileSync(this.dataPath, JSON.stringify(freshData, null, 2));
           }
        }
        
        resolve(modified);
      }).catch(err => {
        console.error("Push queue error:", err);
        resolve(false);
      });
    });
  }

  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // Pull all tasks from Google and update local data
  async pull() {
    if (!this.isAuthenticated() || !this.taskListId) return;

    try {
      const res = await this.tasksApi.tasks.list({
        tasklist: this.taskListId,
        showHidden: true,
        maxResults: 100
      });

      const gTasks = res.data.items || [];

      let data = {};
      if (fs.existsSync(this.dataPath)) {
        data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
      }

      let dataChanged = false;

      for (const gt of gTasks) {
        if (gt.deleted) continue;

        let dateStr;
        if (gt.due) {
          dateStr = gt.due.substring(0, 10);
        } else {
          const d = new Date();
          dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }

        if (!data[dateStr]) data[dateStr] = { todos: [], followups: [], notes: [] };
        if (!data[dateStr].todos) data[dateStr].todos = [];

        const localTask = data[dateStr].todos.find(t => t.googleTaskId === gt.id);
        const done = gt.status === 'completed';

        if (localTask) {
          if (localTask.text !== gt.title || localTask.done !== done) {
            localTask.text = gt.title;
            localTask.done = done;
            dataChanged = true;
          }
        } else {
          data[dateStr].todos.push({
            id: this.uid(),
            text: gt.title,
            done: done,
            googleTaskId: gt.id
          });
          dataChanged = true;
        }
      }

      if (dataChanged) {
        fs.writeFileSync(this.dataPath, JSON.stringify(data, null, 2));
        if (this.onDataUpdated) {
          this.onDataUpdated();
        }
      }
    } catch (e) {
      console.error("Failed to pull tasks", e);
    }
  }
}

module.exports = new GoogleSync();
