let mediaRecorder = null;
let recordedChunks = [];
let stream = null;

const getMimeType = (format) => {
  if (format === "webm") {
    if (MediaRecorder.isTypeSupported("video/webm; codecs=vp9")) {
      return "video/webm; codecs=vp9";
    }
    if (MediaRecorder.isTypeSupported("video/webm; codecs=vp8")) {
      return "video/webm; codecs=vp8";
    }
    return "video/webm";
  } else {
    return "video/mp4";
  }
};

document.getElementById('startBtn').addEventListener('click', startRecording);
document.getElementById('stopBtn').addEventListener('click', stopRecording);

function startRecording() {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const status = document.getElementById('status');
  
  startBtn.disabled = true;
  status.textContent = 'Requesting screen access...';
  
  // Get export format from URL params (default to webm)
  const params = new URLSearchParams(window.location.search);
  const exportFormat = params.get('format') || 'webm';
  
  // Use chrome.desktopCapture to get screen
  chrome.desktopCapture.chooseDesktopMedia(
    ["screen", "window", "tab"],
    function (streamId) {
      if (!streamId) {
        status.textContent = 'Screen capture cancelled';
        startBtn.disabled = false;
        return;
      }
      
      // Get the media stream
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: streamId,
            minWidth: 1280,
            minHeight: 720,
            maxWidth: 1920,
            maxHeight: 1080
          }
        }
      })
      .then((mediaStream) => {
        stream = mediaStream;
        recordedChunks = [];
        
        // Listen for when screen sharing ends
        stream.getVideoTracks()[0].addEventListener('ended', () => {
          console.log('Screen sharing ended, stopping recording...');
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
        });
        
        const mimeType = getMimeType(exportFormat);
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: mimeType,
          videoBitsPerSecond: 3000000
        });
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordedChunks.push(event.data);
          }
        };
        
        mediaRecorder.onstop = () => {
          const blob = new Blob(recordedChunks, { type: mimeType });
          const url = URL.createObjectURL(blob);
          
          // Generate filename with timestamp
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `screen-recording-${timestamp}.${exportFormat}`;
          
          // Get URL parameters
          const recordingId = params.get('recordingId');
          const tabId = params.get('tabId');
          
          // Download the recording
          chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error('Download failed:', chrome.runtime.lastError);
              return;
            }
            
            if (downloadId && recordingId && tabId) {
              // Store the download ID, filename and stop the demo recording
              chrome.runtime.sendMessage({
                action: 'screenRecordingStopped',
                recordingId: recordingId,
                tabId: parseInt(tabId),
                downloadId: downloadId,
                videoFilename: filename
              });
            }
            
            status.textContent = 'Recording saved!';
            document.getElementById('message').textContent = 'You can close this tab now.';
            document.getElementById('message').classList.remove('hidden');
            
            // Clean up stream
            stream.getTracks().forEach(track => track.stop());
            
            // Clean up blob URL
            URL.revokeObjectURL(url);
            
            // Auto close after 3 seconds
            setTimeout(() => {
              window.close();
            }, 3000);
          });
        };
        
        mediaRecorder.start(1000);
        
        // Update UI
        status.innerHTML = '<span class="recording">● Recording...</span>';
        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        
        // Focus back on the original tab if specified
        const tabId = params.get('tabId');
        if (tabId) {
          chrome.tabs.update(parseInt(tabId), { active: true });
        }
      })
      .catch((error) => {
        console.error('Error accessing media devices:', error);
        status.textContent = 'Error: ' + error.message;
        startBtn.disabled = false;
      });
    }
  );
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    
    const stopBtn = document.getElementById('stopBtn');
    const status = document.getElementById('status');
    
    stopBtn.disabled = true;
    status.textContent = 'Saving recording...';
  }
}

// Auto-start recording if specified in URL params
window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === 'true') {
    // Small delay to ensure page is fully loaded
    setTimeout(() => {
      document.getElementById('startBtn').click();
    }, 500);
  }
});