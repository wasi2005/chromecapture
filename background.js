class RecordingSession {
  constructor(tabId, url) {
    this.id = crypto.randomUUID();
    this.tabId = tabId;
    this.url = url;
    this.startTime = Date.now();
    this.actions = [];
    this.videoDownloadId = null;
    this.screenRecordingTabId = null;
    this.metadata = {
      title: '',
      viewport: null,
      userAgent: navigator.userAgent,
      tags: []
    };
  }

  addAction(action) {
    this.actions.push({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...action
    });
  }

  export() {
    return {
      id: this.id,
      url: this.url,
      startTime: this.startTime,
      endTime: Date.now(),
      duration: Date.now() - this.startTime,
      actions: this.actions,
      videoDownloadId: this.videoDownloadId,
      metadata: this.metadata
    };
  }

}

class RecordingManager {
  constructor() {
    this.sessions = new Map();
    this.activeTab = null;
  }

  startRecording(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.get(tabId, async (tab) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        // First, inject the content script if needed
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
          });
          
          // Also inject the CSS
          await chrome.scripting.insertCSS({
            target: { tabId: tabId },
            files: ['overlay.css']
          });
        } catch (err) {
          // Script might already be injected, continue
          console.log('Content script may already be injected:', err);
        }

        const session = new RecordingSession(tabId, tab.url);
        session.metadata.title = tab.title;
        this.sessions.set(tabId, session);
        this.activeTab = tabId;

        // Small delay to ensure content script is ready
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, {
            action: 'startRecording',
            sessionId: session.id
          }, () => {
            if (chrome.runtime.lastError) {
              this.sessions.delete(tabId);
              reject(chrome.runtime.lastError);
            } else {
              chrome.action.setBadgeText({ text: 'REC', tabId });
              chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId });
              resolve(session);
            }
          });
        }, 100);
      });
    });
  }


  async stopRecording(tabId) {
    const session = this.sessions.get(tabId);
    if (!session) return null;

    console.log('Stopping recording for tab:', tabId, 'Session:', session.id);
    
    // Stop action recording
    chrome.tabs.sendMessage(tabId, { action: 'stopRecording' });
    chrome.action.setBadgeText({ text: '', tabId });
    
    
    const exportData = session.export();
    
    this.sessions.delete(tabId);
    if (this.activeTab === tabId) {
      this.activeTab = null;
    }

    return exportData;
  }

  pauseRecording(tabId) {
    const session = this.sessions.get(tabId);
    if (!session) return false;

    session.isPaused = true;
    chrome.tabs.sendMessage(tabId, { action: 'pauseRecording' });
    chrome.action.setBadgeBackgroundColor({ color: '#FFA500', tabId });
    return true;
  }

  resumeRecording(tabId) {
    const session = this.sessions.get(tabId);
    if (!session) return false;

    session.isPaused = false;
    chrome.tabs.sendMessage(tabId, { action: 'resumeRecording' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId });
    return true;
  }

  addAction(tabId, action) {
    const session = this.sessions.get(tabId);
    if (session && !session.isPaused) {
      session.addAction(action);
      return true;
    }
    return false;
  }

  getSession(tabId) {
    return this.sessions.get(tabId);
  }

  isRecording(tabId) {
    return this.sessions.has(tabId);
  }

  async startCombinedRecording(tabId) {
    try {
      // Start the demo recording
      const session = await this.startRecording(tabId);
      
      // Start screen recording in a new tab
      chrome.tabs.create({
        url: chrome.runtime.getURL(`screen-recorder.html?tabId=${tabId}&format=webm&autostart=true&recordingId=${session.id}`)
      }, (screenTab) => {
        if (screenTab) {
          session.screenRecordingTabId = screenTab.id;
        }
      });
      
      return session;
    } catch (error) {
      throw error;
    }
  }

  async stopCombinedRecording(tabId) {
    const session = this.sessions.get(tabId);
    if (!session) return null;

    // Stop the demo recording
    const exportData = await this.stopRecording(tabId);
    
    // No need to close screen recording tab - it closes itself

    return exportData;
  }
}

const recordingManager = new RecordingManager();


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  switch (request.action) {
    case 'startCombinedRecording':
      recordingManager.startCombinedRecording(request.tabId)
        .then(session => sendResponse({ success: true, sessionId: session.id }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'stopCombinedRecording':
      recordingManager.stopCombinedRecording(request.tabId)
        .then(recording => {
          if (recording) {
            sendResponse({ success: true, recording });
          } else {
            sendResponse({ success: false, error: 'No active recording' });
          }
        })
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'startRecording':
      recordingManager.startRecording(request.tabId)
        .then(session => sendResponse({ success: true, sessionId: session.id }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    

    case 'stopRecording':
      recordingManager.stopRecording(request.tabId)
        .then(recording => {
          if (recording) {
            // Don't save yet - wait for user to name it
            sendResponse({ success: true, recording });
          } else {
            sendResponse({ success: false, error: 'No active recording' });
          }
        })
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'saveNamedRecording':
      if (request.recording) {
        saveRecording(request.recording)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
      } else {
        sendResponse({ success: false, error: 'No recording provided' });
      }
      return true;

    case 'pauseRecording':
      const paused = recordingManager.pauseRecording(request.tabId);
      sendResponse({ success: paused });
      break;

    case 'resumeRecording':
      const resumed = recordingManager.resumeRecording(request.tabId);
      sendResponse({ success: resumed });
      break;

    case 'recordAction':
      if (sender.tab) {
        const added = recordingManager.addAction(sender.tab.id, request.actionData);
        console.log('Action recorded:', request.actionData.type, 'Has screenshot:', !!request.actionData.screenshot);
        sendResponse({ success: added });
      }
      break;

    case 'getStatus':
      const isRecording = recordingManager.isRecording(request.tabId);
      const session = recordingManager.getSession(request.tabId);
      sendResponse({ 
        isRecording,
        isPaused: session?.isPaused || false,
        sessionId: session?.id 
      });
      break;

    case 'getSavedRecordings':
      getSavedRecordings().then(recordings => sendResponse(recordings));
      return true;

    case 'deleteRecording':
      deleteRecording(request.recordingId)
        .then(() => sendResponse({ success: true }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'exportRecording':
      exportRecording(request.recordingId, request.format)
        .then(data => sendResponse({ success: true, data }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
    

    case 'screenRecordingStopped':
      // Handle when screen recording stops - this should stop the demo recording too
      const activeSession = recordingManager.getSession(request.tabId);
      
      if (activeSession && request.recordingId === activeSession.id) {
        // Store the download ID
        activeSession.videoDownloadId = request.downloadId;
        
        // Stop the demo recording
        recordingManager.stopCombinedRecording(request.tabId)
          .then(recording => {
            if (recording) {
              // Store the completed recording for the popup to pick up
              chrome.storage.local.set({
                [`pendingRecording_${request.tabId}`]: recording
              });
              
              // Send response
              sendResponse({ success: true, recording: recording });
            } else {
              sendResponse({ success: false, error: 'Failed to stop recording' });
            }
          })
          .catch(error => sendResponse({ success: false, error: error.message }));
      } else {
        sendResponse({ success: false, error: 'Recording session not found' });
      }
      return true;

    case 'openVideo':
      getSavedRecordings().then(recordings => {
        const recording = recordings.find(r => r.id === request.recordingId);
        if (recording && recording.videoDownloadId) {
          // Use chrome.downloads.open to open the downloaded file
          chrome.downloads.open(recording.videoDownloadId, () => {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: 'Could not open video file: ' + chrome.runtime.lastError.message });
            } else {
              sendResponse({ success: true });
            }
          });
        } else {
          sendResponse({ success: false, error: 'Video not found' });
        }
      });
      return true;

    case 'startScreenRecording':
      // Open screen recording page
      chrome.tabs.create({
        url: chrome.runtime.getURL(`screen-recorder.html?tabId=${request.tabId}&format=${request.format || 'webm'}&autostart=true`)
      }, (tab) => {
        sendResponse({ success: true, tabId: tab.id });
      });
      return true;
    
    case 'captureScreenshot':
      if (sender.tab) {
        chrome.tabs.captureVisibleTab(sender.tab.windowId, 
          { format: 'png', quality: 90 }, 
          (dataUrl) => {
            if (chrome.runtime.lastError) {
              console.error('Screenshot failed:', chrome.runtime.lastError);
              sendResponse({ success: false });
            } else {
              sendResponse({ success: true, screenshot: dataUrl });
            }
          }
        );
        return true;
      }
      break;
  }
});

async function saveRecording(recording) {
  try {
    const saved = await chrome.storage.local.get(['recordings']);
    const recordings = saved.recordings || [];
    recordings.unshift(recording);
    
    // Keep only 50 most recent recordings
    if (recordings.length > 50) {
      recordings.splice(50);
    }
    
    await chrome.storage.local.set({ recordings });
    console.log('Recording saved with ID:', recording.id);
  } catch (error) {
    console.error('Failed to save recording:', error);
  }
}

async function getSavedRecordings() {
  try {
    const saved = await chrome.storage.local.get(['recordings']);
    return saved.recordings || [];
  } catch (error) {
    console.error('Failed to get recordings:', error);
    return [];
  }
}

async function deleteRecording(recordingId) {
  const saved = await chrome.storage.local.get(['recordings']);
  const recordings = saved.recordings || [];
  const index = recordings.findIndex(r => r.id === recordingId);
  
  if (index !== -1) {
    recordings.splice(index, 1);
    await chrome.storage.local.set({ recordings });
  }
}

async function exportRecording(recordingId, format) {
  const recordings = await getSavedRecordings();
  const recording = recordings.find(r => r.id === recordingId);
  
  if (!recording) {
    throw new Error('Recording not found');
  }

  switch (format) {
    case 'json':
      return JSON.stringify(recording, null, 2);
    
    case 'markdown':
      return generateMarkdown(recording);
    
    case 'html':
      return generateHTML(recording);
    
    default:
      throw new Error('Unsupported export format');
  }
}

function generateMarkdown(recording) {
  let markdown = `# ${recording.metadata.title || 'Recording'}\n\n`;
  markdown += `**URL:** ${recording.url}\n`;
  markdown += `**Duration:** ${Math.round(recording.duration / 1000)}s\n\n`;
  markdown += `## Steps\n\n`;

  recording.actions.forEach((action, index) => {
    markdown += `${index + 1}. **${action.type}**`;
    if (action.element?.text) {
      markdown += ` - "${action.element.text}"`;
    }
    if (action.value) {
      markdown += ` - Entered: "${action.value}"`;
    }
    markdown += '\n';
  });

  return markdown;
}

function generateHTML(recording) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>${recording.metadata?.title || 'Demo Recording'}</title>
  <style>
    body { 
      font-family: system-ui, -apple-system, sans-serif; 
      max-width: 1200px; 
      margin: 0 auto; 
      padding: 20px;
      background: #f5f5f5;
    }
    .header {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    h1 { 
      margin: 0 0 10px 0; 
      color: #333;
    }
    .meta { 
      color: #666; 
      font-size: 14px;
    }
    .container {
      width: 100%;
    }
    .actions-section {
      width: 100%;
    }
    .step { 
      background: white;
      padding: 15px; 
      margin: 0 0 10px 0; 
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      transition: all 0.2s;
    }
    .step:hover {
      box-shadow: 0 4px 8px rgba(0,0,0,0.15);
      transform: translateY(-1px);
    }
    .step.click { 
      border-left: 4px solid #007bff; 
    }
    .step.input { 
      border-left: 4px solid #28a745; 
    }
    .step.scroll { 
      border-left: 4px solid #ffc107; 
    }
    .step-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .step-number { 
      font-weight: bold; 
      color: #007bff; 
      font-size: 14px;
    }
    .step-type {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .step-type.click { background: #e3f2fd; color: #1976d2; }
    .step-type.input { background: #e8f5e9; color: #388e3c; }
    .step-type.scroll { background: #fff8e1; color: #f57c00; }
    .step-type.submit { background: #f3e5f5; color: #7b1fa2; }
    .element-info {
      background: #f8f9fa;
      padding: 8px;
      border-radius: 4px;
      margin: 8px 0;
      font-family: monospace;
      font-size: 12px;
      color: #495057;
    }
    .timestamp { 
      color: #6c757d; 
      font-size: 12px;
      margin-top: 8px;
    }
    .value-entered {
      background: #d4edda;
      color: #155724;
      padding: 8px;
      border-radius: 4px;
      margin: 8px 0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${recording.metadata?.title || 'Demo Recording'}</h1>
    ${recording.metadata?.featureDescription ? `
      <p style="margin: 10px 0; color: #666; font-size: 14px; line-height: 1.4;">
        ${recording.metadata.featureDescription}
      </p>
    ` : ''}
    <div class="meta">
      <strong>URL:</strong> <a href="${recording.url}" target="_blank">${recording.url}</a><br>
      <strong>Duration:</strong> ${Math.round(recording.duration / 1000)}s<br>
      <strong>Actions:</strong> ${recording.actions.length}<br>
      <strong>Recorded:</strong> ${new Date(recording.startTime).toLocaleString()}
    </div>
  </div>

  <div class="container">
    <div class="actions-section">
      <h2 style="margin: 0 0 20px 0; color: #333;">Recorded Actions</h2>
      ${recording.actions.map((action, index) => {
        const timeSinceStart = ((action.timestamp - recording.startTime) / 1000).toFixed(1);
        return `
          <div class="step ${action.type}">
            <div class="step-header">
              <span class="step-number">Step ${index + 1}</span>
              <span class="step-type ${action.type}">${action.type}</span>
            </div>
            
            ${action.screenshot ? `
              <div class="screenshot-container" style="margin: 10px 0;">
                <img src="${action.screenshot}" alt="Step ${index + 1} screenshot" 
                     style="width: 100%; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;"
                     onclick="window.open('${action.screenshot}', '_blank')">
              </div>
            ` : ''}
            
            ${action.element?.selector ? `
              <div class="element-info">
                ${action.element.selector}
              </div>
            ` : ''}
            
            ${action.element?.text ? `
              <div><strong>Element:</strong> "${action.element.text.substring(0, 50)}${action.element.text.length > 50 ? '...' : ''}"</div>
            ` : ''}
            
            ${action.value ? `
              <div class="value-entered">
                <strong>Entered:</strong> "${action.value}"
              </div>
            ` : ''}
            
            ${action.type === 'scroll' ? `
              <div>Scrolled to: ${action.viewport.scrollX}, ${action.viewport.scrollY}</div>
            ` : ''}
            
            <div class="timestamp">
              ${new Date(action.timestamp).toLocaleTimeString()} 
              <span style="margin-left: 10px">(+${timeSinceStart}s)</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  </div>

</body>
</html>`;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingManager.isRecording(tabId)) {
    recordingManager.stopRecording(tabId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && recordingManager.isRecording(tabId)) {
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, {
        action: 'startRecording',
        sessionId: recordingManager.getSession(tabId)?.id
      });
    }, 500);
  }
});