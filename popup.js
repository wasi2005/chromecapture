class PopupController {
  constructor() {
    this.currentTab = null;
    this.isRecording = false;
    this.isPaused = false;
    this.startTime = null;
    this.timerInterval = null;
    this.actionCount = 0;
    
    this.initializeElements();
    this.attachListeners();
    this.initialize();
  }

  initializeElements() {
    this.elements = {
      status: document.getElementById('status'),
      statusIndicator: document.getElementById('statusIndicator'),
      statusText: document.getElementById('statusText'),
      startBtn: document.getElementById('startBtn'),
      pauseBtn: document.getElementById('pauseBtn'),
      resumeBtn: document.getElementById('resumeBtn'),
      stopBtn: document.getElementById('stopBtn'),
      recordingInfo: document.getElementById('recordingInfo'),
      timer: document.getElementById('timer'),
      actionCount: document.getElementById('actionCount'),
      recordingsList: document.getElementById('recordingsList'),
      refreshBtn: document.getElementById('refreshBtn'),
      settingsBtn: document.getElementById('settingsBtn'),
      helpBtn: document.getElementById('helpBtn'),
      // Modal elements
      namingModal: document.getElementById('namingModal'),
      namingForm: document.getElementById('namingForm'),
      demoName: document.getElementById('demoName'),
      featureDescription: document.getElementById('featureDescription'),
      cancelNaming: document.getElementById('cancelNaming')
    };
    this.pendingRecording = null;
  }

  attachListeners() {
    this.elements.startBtn.addEventListener('click', () => this.startRecording());
    this.elements.pauseBtn.addEventListener('click', () => this.pauseRecording());
    this.elements.resumeBtn.addEventListener('click', () => this.resumeRecording());
    this.elements.stopBtn.addEventListener('click', () => this.stopRecording());
    this.elements.refreshBtn.addEventListener('click', () => this.loadRecordings());
    this.elements.settingsBtn.addEventListener('click', () => this.openSettings());
    this.elements.helpBtn.addEventListener('click', () => this.openHelp());
    
    
    // Modal listeners
    this.elements.namingForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveNamedRecording();
    });
    this.elements.cancelNaming.addEventListener('click', () => {
      this.hideNamingModal();
    });
    
  }

  async initialize() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.currentTab = tab;
      
      await this.checkRecordingStatus();
      await this.loadRecordings();
    } catch (error) {
      console.error('Initialization error:', error);
      this.showError('Failed to initialize');
    }
  }

  async checkRecordingStatus() {
    if (!this.currentTab) return;

    chrome.runtime.sendMessage({
      action: 'getStatus',
      tabId: this.currentTab.id
    }, (response) => {
      if (response) {
        this.isRecording = response.isRecording;
        this.isPaused = response.isPaused;
        
        if (this.isRecording) {
          this.updateUIForRecording();
          if (this.isPaused) {
            this.updateUIForPause();
          }
        } else {
          this.updateUIForStopped();
        }
      }
    });
  }

  async startRecording() {
    if (!this.currentTab) return;

    this.elements.startBtn.disabled = true;
    
    chrome.runtime.sendMessage({
      action: 'startRecording',
      tabId: this.currentTab.id
    }, (response) => {
      if (response.success) {
        this.isRecording = true;
        this.startTime = Date.now();
        this.actionCount = 0;
        this.updateUIForRecording();
        this.startTimer();
        
      } else {
        this.showError('Failed to start recording: ' + (response.error || 'Unknown error'));
        this.elements.startBtn.disabled = false;
      }
    });
  }

  async pauseRecording() {
    if (!this.currentTab || !this.isRecording) return;

    chrome.runtime.sendMessage({
      action: 'pauseRecording',
      tabId: this.currentTab.id
    }, (response) => {
      if (response.success) {
        this.isPaused = true;
        this.updateUIForPause();
        this.stopTimer();
      }
    });
  }

  async resumeRecording() {
    if (!this.currentTab || !this.isRecording) return;

    chrome.runtime.sendMessage({
      action: 'resumeRecording',
      tabId: this.currentTab.id
    }, (response) => {
      if (response.success) {
        this.isPaused = false;
        this.updateUIForRecording();
        this.startTimer();
      }
    });
  }

  async stopRecording() {
    if (!this.currentTab || !this.isRecording) return;

    this.elements.stopBtn.disabled = true;
    
    chrome.runtime.sendMessage({
      action: 'stopRecording',
      tabId: this.currentTab.id
    }, (response) => {
      if (response.success) {
        this.isRecording = false;
        this.isPaused = false;
        this.stopTimer();
        this.updateUIForStopped();
        
        if (response.recording) {
          // Store the recording temporarily and show naming modal
          this.pendingRecording = response.recording;
          this.showNamingModal();
        }
      } else {
        this.showError('Failed to stop recording');
      }
      this.elements.stopBtn.disabled = false;
    });
  }
  
  showNamingModal() {
    this.elements.namingModal.style.display = 'flex';
    this.elements.demoName.value = '';
    this.elements.featureDescription.value = '';
    this.elements.demoName.focus();
  }
  
  hideNamingModal() {
    this.elements.namingModal.style.display = 'none';
    this.pendingRecording = null;
  }
  
  async saveNamedRecording() {
    if (!this.pendingRecording) return;
    
    // Add the name and description to the recording metadata
    this.pendingRecording.metadata = this.pendingRecording.metadata || {};
    this.pendingRecording.metadata.title = this.elements.demoName.value;
    this.pendingRecording.metadata.featureDescription = this.elements.featureDescription.value;
    
    // Save the recording with the new metadata
    chrome.runtime.sendMessage({
      action: 'saveNamedRecording',
      recording: this.pendingRecording
    }, (response) => {
      if (response && response.success) {
        this.showSuccess('Recording saved: ' + this.elements.demoName.value);
        this.hideNamingModal();
        setTimeout(() => this.loadRecordings(), 500);
      } else {
        this.showError('Failed to save recording');
      }
    });
  }

  updateUIForRecording() {
    this.elements.statusIndicator.className = 'status-indicator recording';
    this.elements.statusText.textContent = 'Recording Actions';
    this.elements.startBtn.style.display = 'none';
    this.elements.pauseBtn.style.display = 'flex';
    this.elements.resumeBtn.style.display = 'none';
    this.elements.stopBtn.style.display = 'flex';  // Show the stop button
    this.elements.recordingInfo.style.display = 'flex';
  }

  updateUIForPause() {
    this.elements.statusIndicator.className = 'status-indicator paused';
    this.elements.statusText.textContent = 'Paused';
    this.elements.pauseBtn.style.display = 'none';
    this.elements.resumeBtn.style.display = 'flex';
  }

  updateUIForStopped() {
    this.elements.statusIndicator.className = 'status-indicator';
    this.elements.statusText.textContent = 'Ready';
    this.elements.startBtn.style.display = 'flex';
    this.elements.pauseBtn.style.display = 'none';
    this.elements.resumeBtn.style.display = 'none';
    this.elements.stopBtn.style.display = 'none';
    this.elements.recordingInfo.style.display = 'none';
    this.elements.timer.textContent = '00:00';
    this.elements.actionCount.textContent = '0';
  }

  startTimer() {
    if (this.timerInterval) return;
    
    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const seconds = (elapsed % 60).toString().padStart(2, '0');
      this.elements.timer.textContent = `${minutes}:${seconds}`;
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  async loadRecordings() {
    chrome.runtime.sendMessage({ action: 'getSavedRecordings' }, (recordings) => {
      if (!recordings || recordings.length === 0) {
        this.elements.recordingsList.innerHTML = `
          <div class="empty-state">
            <p>No recordings yet</p>
            <p class="hint">Click "Start Recording" to begin</p>
          </div>
        `;
        return;
      }

      this.elements.recordingsList.innerHTML = recordings.map(recording => {
        const duration = Math.round((recording.duration || 0) / 1000);
        const time = new Date(recording.startTime).toLocaleTimeString();
        
        return `
          <div class="recording-item" data-id="${recording.id}">
            <div class="recording-title">${recording.metadata?.title || 'Untitled Recording'}</div>
            <div class="recording-meta">
              <span>${recording.actions?.length || 0} actions</span>
              <span>${duration}s</span>
              <span>${time}</span>
            </div>
            <div class="recording-actions">
              <button class="export-btn" data-id="${recording.id}" data-format="html">View Demo</button>
              <button class="delete-btn" data-id="${recording.id}">Delete</button>
            </div>
          </div>
        `;
      }).join('');

      this.attachRecordingListeners();
    });
  }

  attachRecordingListeners() {
    document.querySelectorAll('.export-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const recordingId = e.target.dataset.id;
        const format = e.target.dataset.format;
        this.exportRecording(recordingId, format);
      });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const recordingId = e.target.dataset.id;
        if (confirm('Delete this recording?')) {
          this.deleteRecording(recordingId);
        }
      });
    });
  }

  async exportRecording(recordingId, format) {
    chrome.runtime.sendMessage({
      action: 'exportRecording',
      recordingId,
      format
    }, (response) => {
      if (response && response.success) {
        let mimeType, filename, blob, url;
        
        // Handle formats
        switch(format) {
            case 'json':
              mimeType = 'application/json';
              filename = `recording-${recordingId.substring(0, 8)}.json`;
              blob = new Blob([response.data], { type: mimeType });
              break;
            case 'markdown':
              mimeType = 'text/markdown';
              filename = `recording-${recordingId.substring(0, 8)}.md`;
              blob = new Blob([response.data], { type: mimeType });
              break;
            case 'html':
              mimeType = 'text/html';
              filename = `recording-${recordingId.substring(0, 8)}.html`;
              blob = new Blob([response.data], { type: mimeType });
              break;
            default:
              mimeType = 'text/plain';
              filename = `recording-${recordingId.substring(0, 8)}.txt`;
              blob = new Blob([response.data], { type: mimeType });
        }
        
        url = URL.createObjectURL(blob);
        
        chrome.downloads.download({
          url: url,
          filename: filename,
          saveAs: true
        }, () => {
          if (chrome.runtime.lastError) {
            this.showError('Download failed: ' + chrome.runtime.lastError.message);
          } else {
            URL.revokeObjectURL(url);
            this.showSuccess(`Exported as ${format.toUpperCase()}`);
          }
        });
      } else {
        this.showError('Export failed: ' + (response?.error || 'Unknown error'));
      }
    });
  }

  async deleteRecording(recordingId) {
    chrome.runtime.sendMessage({
      action: 'deleteRecording',
      recordingId
    }, (response) => {
      if (response.success) {
        this.showSuccess('Recording deleted');
        this.loadRecordings();
      } else {
        this.showError('Failed to delete recording');
      }
    });
  }

  openSettings() {
    chrome.runtime.openOptionsPage();
  }

  openHelp() {
    chrome.tabs.create({ url: 'https://github.com/yourusername/demo-recorder/wiki' });
  }

  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  showError(message) {
    this.showNotification(message, 'error');
  }

  showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${type === 'success' ? '#28a745' : '#dc3545'};
      color: white;
      border-radius: 4px;
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }
  
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});