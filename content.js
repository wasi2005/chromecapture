class ElementSelector {
  static getSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }

    if (element.getAttribute('data-testid')) {
      return `[data-testid="${element.getAttribute('data-testid')}"]`;
    }

    if (element.getAttribute('aria-label')) {
      return `[aria-label="${element.getAttribute('aria-label')}"]`;
    }

    const className = Array.from(element.classList)
      .filter(c => !c.includes('hover') && !c.includes('active') && !c.includes('focus'))
      .join('.');
    
    if (className) {
      const selector = `${element.tagName.toLowerCase()}.${className}`;
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    }

    return this.getPathSelector(element);
  }

  static getPathSelector(element) {
    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();
      
      if (current.id) {
        selector = `#${current.id}`;
        path.unshift(selector);
        break;
      }
      
      const siblings = Array.from(current.parentNode?.children || []);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
      
      path.unshift(selector);
      current = current.parentNode;
    }

    return path.join(' > ');
  }

  static getXPath(element) {
    const allNodes = document.evaluate('.//*', document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    
    for (let i = 0; i < allNodes.snapshotLength; i++) {
      if (allNodes.snapshotItem(i) === element) {
        return `(//*)[${i + 1}]`;
      }
    }
    
    return null;
  }

  static getElementInfo(element) {
    const rect = element.getBoundingClientRect();
    
    return {
      selector: this.getSelector(element),
      xpath: this.getXPath(element),
      text: element.innerText?.substring(0, 100) || element.value || element.placeholder || '',
      tag: element.tagName,
      attributes: {
        id: element.id || null,
        class: element.className || null,
        name: element.name || null,
        type: element.type || null,
        role: element.getAttribute('role') || null,
        'aria-label': element.getAttribute('aria-label') || null,
        'data-testid': element.getAttribute('data-testid') || null
      },
      position: {
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }
}

class ActionRecorder {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    self.sessionId = null;
    this.lastAction = null;
    this.inputBuffer = new Map();
    this.listeners = new Map();
  }

  start(sessionId) {
    if (this.isRecording) return;
    
    this.isRecording = true;
    this.sessionId = sessionId;
    this.attachListeners();
    // this.injectOverlay(); // Disabled overlay
  }

  stop() {
    if (!this.isRecording) return;
    
    this.isRecording = false;
    this.sessionId = null;
    this.detachListeners();
    // this.removeOverlay(); // Disabled overlay
    this.inputBuffer.clear();
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
  }

  attachListeners() {
    const events = {
      'click': this.handleClick.bind(this),
      'dblclick': this.handleDoubleClick.bind(this),
      'input': this.handleInput.bind(this),
      'change': this.handleChange.bind(this),
      'submit': this.handleSubmit.bind(this),
      'keydown': this.handleKeydown.bind(this),
      'scroll': this.handleScroll.bind(this),
      'mouseover': this.handleMouseover.bind(this),
      'focus': this.handleFocus.bind(this),
      'blur': this.handleBlur.bind(this)
    };

    for (const [event, handler] of Object.entries(events)) {
      const wrappedHandler = (e) => {
        if (!this.isPaused && this.isRecording) {
          handler(e);
        }
      };
      this.listeners.set(event, wrappedHandler);
      document.addEventListener(event, wrappedHandler, true);
    }
  }

  detachListeners() {
    for (const [event, handler] of this.listeners.entries()) {
      document.removeEventListener(event, handler, true);
    }
    this.listeners.clear();
  }

  handleClick(event) {
    const element = event.target;
    if (this.shouldIgnoreElement(element)) return;

    const action = {
      type: 'click',
      element: ElementSelector.getElementInfo(element),
      viewport: {
        scrollX: window.scrollX,
        scrollY: window.scrollY
      },
      modifiers: {
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey
      }
    };

    this.recordAction(action);
    // this.flashElement(element); // Disabled flash effect
  }

  handleDoubleClick(event) {
    const element = event.target;
    if (this.shouldIgnoreElement(element)) return;

    const action = {
      type: 'dblclick',
      element: ElementSelector.getElementInfo(element),
      viewport: {
        scrollX: window.scrollX,
        scrollY: window.scrollY
      }
    };

    this.recordAction(action);
  }

  handleInput(event) {
    const element = event.target;
    if (this.shouldIgnoreElement(element)) return;

    clearTimeout(this.inputBuffer.get(element));
    
    const timeoutId = setTimeout(() => {
      const action = {
        type: 'input',
        element: ElementSelector.getElementInfo(element),
        value: this.maskSensitiveData(element.value, element),
        inputType: element.type || 'text'
      };
      
      this.recordAction(action);
      this.inputBuffer.delete(element);
    }, 500);
    
    this.inputBuffer.set(element, timeoutId);
  }

  handleChange(event) {
    const element = event.target;
    if (this.shouldIgnoreElement(element)) return;

    if (element.tagName === 'SELECT') {
      const action = {
        type: 'select',
        element: ElementSelector.getElementInfo(element),
        value: element.value,
        text: element.options[element.selectedIndex]?.text
      };
      
      this.recordAction(action);
    } else if (element.type === 'checkbox' || element.type === 'radio') {
      const action = {
        type: element.type,
        element: ElementSelector.getElementInfo(element),
        checked: element.checked
      };
      
      this.recordAction(action);
    }
  }

  handleSubmit(event) {
    const element = event.target;
    if (this.shouldIgnoreElement(element)) return;

    const action = {
      type: 'submit',
      element: ElementSelector.getElementInfo(element),
      formData: this.extractFormData(element)
    };

    this.recordAction(action);
  }

  handleKeydown(event) {
    if (event.key === 'Tab' || event.key === 'Enter' || event.key === 'Escape') {
      const action = {
        type: 'keypress',
        key: event.key,
        code: event.code,
        element: ElementSelector.getElementInfo(event.target),
        modifiers: {
          alt: event.altKey,
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          shift: event.shiftKey
        }
      };
      
      if (!this.isDuplicateAction(action)) {
        this.recordAction(action);
      }
    }
  }

  handleScroll(event) {
    clearTimeout(this.scrollTimeout);
    
    this.scrollTimeout = setTimeout(() => {
      const action = {
        type: 'scroll',
        viewport: {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          width: window.innerWidth,
          height: window.innerHeight
        }
      };
      
      this.recordAction(action);
    }, 200);
  }

  handleMouseover(event) {
    const element = event.target;
    
    if (element.hasAttribute('title') || element.hasAttribute('data-tooltip')) {
      setTimeout(() => {
        const tooltip = document.querySelector('.tooltip:visible, [role="tooltip"]:visible');
        if (tooltip) {
          const action = {
            type: 'hover',
            element: ElementSelector.getElementInfo(element),
            tooltip: tooltip.innerText
          };
          
          this.recordAction(action);
        }
      }, 100);
    }
  }

  handleFocus(event) {
    const element = event.target;
    if (this.shouldIgnoreElement(element)) return;

    const action = {
      type: 'focus',
      element: ElementSelector.getElementInfo(element)
    };

    this.recordAction(action);
  }

  handleBlur(event) {
    const element = event.target;
    if (this.shouldIgnoreElement(element)) return;

    const action = {
      type: 'blur',
      element: ElementSelector.getElementInfo(element)
    };

    this.recordAction(action);
  }

  async recordAction(action) {
    // Wait for action to complete and page to stabilize before screenshot
    await this.waitForPageStabilization(action);
    
    // Capture screenshot for this action
    try {
      const screenshot = await this.captureVisibleArea();
      action.screenshot = screenshot;
    } catch (error) {
      console.log('Could not capture screenshot:', error);
    }
    
    chrome.runtime.sendMessage({
      action: 'recordAction',
      actionData: action
    });
    
    this.lastAction = action;
  }
  
  async waitForPageStabilization(action) {
    // Different wait strategies based on action type
    if (action.type === 'click' || action.type === 'submit') {
      // For clicks and submits, wait for DOM changes and network
      await this.waitForDOMStability();
      await this.waitForNetworkIdle(1000);
    } else if (action.type === 'input' || action.type === 'change') {
      // For inputs, wait a bit for any reactive changes
      await new Promise(resolve => setTimeout(resolve, 300));
    } else if (action.type === 'scroll') {
      // For scrolls, wait for scroll to finish and images to load
      await new Promise(resolve => setTimeout(resolve, 500));
      await this.waitForImagesInViewport();
    } else {
      // Default small delay
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  async waitForDOMStability() {
    return new Promise((resolve) => {
      let observer;
      let timeout;
      
      const done = () => {
        if (observer) observer.disconnect();
        clearTimeout(timeout);
        resolve();
      };
      
      // Set max wait time
      timeout = setTimeout(done, 1000);
      
      // Wait for at least one animation frame
      requestAnimationFrame(() => {
        // Then watch for DOM changes
        observer = new MutationObserver(() => {
          clearTimeout(timeout);
          timeout = setTimeout(done, 200); // No changes for 200ms = stable
        });
        
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
        
        // Trigger initial timeout
        clearTimeout(timeout);
        timeout = setTimeout(done, 200);
      });
    });
  }
  
  async waitForImagesInViewport() {
    const images = Array.from(document.querySelectorAll('img')).filter(img => {
      const rect = img.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    });
    
    const imagePromises = images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        // Timeout after 500ms per image
        setTimeout(resolve, 500);
      });
    });
    
    await Promise.all(imagePromises);
  }
  
  async waitForNetworkIdle(maxWaitTime = 1500) {
    return new Promise((resolve) => {
      let pendingRequests = 0;
      let idleTimer;
      const startTime = Date.now();
      
      // Function to check if we should resolve
      const checkIdle = () => {
        if (pendingRequests === 0) {
          // Network is idle, wait a bit more to ensure page rendering
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => resolve(), 300);
        }
      };
      
      // Monitor fetch requests
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        pendingRequests++;
        try {
          const result = await originalFetch(...args);
          return result;
        } finally {
          pendingRequests--;
          checkIdle();
        }
      };
      
      // Monitor XMLHttpRequests
      const XHROpen = XMLHttpRequest.prototype.open;
      const XHRSend = XMLHttpRequest.prototype.send;
      
      XMLHttpRequest.prototype.open = function(...args) {
        this._monitored = true;
        return XHROpen.apply(this, args);
      };
      
      XMLHttpRequest.prototype.send = function(...args) {
        if (this._monitored) {
          pendingRequests++;
          
          const cleanup = () => {
            pendingRequests--;
            checkIdle();
          };
          
          this.addEventListener('load', cleanup);
          this.addEventListener('error', cleanup);
          this.addEventListener('abort', cleanup);
        }
        return XHRSend.apply(this, args);
      };
      
      // Timeout fallback
      setTimeout(() => {
        // Restore original functions
        window.fetch = originalFetch;
        XMLHttpRequest.prototype.open = XHROpen;
        XMLHttpRequest.prototype.send = XHRSend;
        resolve();
      }, maxWaitTime);
      
      // Initial check
      checkIdle();
    });
  }
  
  async captureVisibleArea() {
    // Send message to background to capture visible tab
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'captureScreenshot'
      }, (response) => {
        if (response && response.screenshot) {
          resolve(response.screenshot);
        } else {
          resolve(null);
        }
      });
    });
  }

  shouldIgnoreElement(element) {
    if (element.closest('#demo-recorder-overlay')) return true;
    
    if (element.type === 'password') return false;
    
    const ignoreTags = ['HTML', 'HEAD', 'META', 'TITLE', 'SCRIPT', 'STYLE', 'LINK'];
    if (ignoreTags.includes(element.tagName)) return true;
    
    return false;
  }

  isDuplicateAction(action) {
    if (!this.lastAction) return false;
    
    const timeDiff = Date.now() - (this.lastAction.timestamp || 0);
    if (timeDiff < 100) {
      return JSON.stringify(action.type) === JSON.stringify(this.lastAction.type) &&
             JSON.stringify(action.element?.selector) === JSON.stringify(this.lastAction.element?.selector);
    }
    
    return false;
  }

  maskSensitiveData(value, element) {
    const sensitiveFields = ['password', 'credit', 'card', 'cvv', 'ssn', 'secret'];
    const fieldName = (element.name + element.id + element.className).toLowerCase();
    
    if (element.type === 'password') {
      return '*'.repeat(value.length);
    }
    
    if (sensitiveFields.some(field => fieldName.includes(field))) {
      return '*'.repeat(value.length);
    }
    
    const emailRegex = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    value = value.replace(emailRegex, (match, local, domain) => {
      return local.charAt(0) + '***@' + domain;
    });
    
    return value;
  }

  extractFormData(form) {
    const formData = {};
    const elements = form.elements;
    
    for (let element of elements) {
      if (element.name && !element.disabled) {
        if (element.type === 'password') {
          formData[element.name] = '***';
        } else if (element.type === 'checkbox' || element.type === 'radio') {
          if (element.checked) {
            formData[element.name] = element.value;
          }
        } else {
          formData[element.name] = this.maskSensitiveData(element.value, element);
        }
      }
    }
    
    return formData;
  }

  injectOverlay() {
    if (document.getElementById('demo-recorder-overlay')) return;
    
    const overlay = document.createElement('div');
    overlay.id = 'demo-recorder-overlay';
    overlay.innerHTML = `
      <div class="recording-indicator">
        <span class="recording-dot"></span>
        <span class="recording-text">Recording</span>
      </div>
    `;
    
    document.body.appendChild(overlay);
  }

  removeOverlay() {
    const overlay = document.getElementById('demo-recorder-overlay');
    if (overlay) {
      overlay.remove();
    }
  }

  flashElement(element) {
    const flash = document.createElement('div');
    flash.className = 'demo-recorder-flash';
    const rect = element.getBoundingClientRect();
    
    flash.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 2px solid #007bff;
      background: rgba(0, 123, 255, 0.1);
      pointer-events: none;
      z-index: 999999;
      animation: flash 0.5s ease-out;
    `;
    
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 500);
  }
}

const recorder = new ActionRecorder();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'startRecording':
      recorder.start(request.sessionId);
      sendResponse({ success: true });
      break;
      
    case 'stopRecording':
      recorder.stop();
      sendResponse({ success: true });
      break;
      
    case 'pauseRecording':
      recorder.pause();
      sendResponse({ success: true });
      break;
      
    case 'resumeRecording':
      recorder.resume();
      sendResponse({ success: true });
      break;
      
    case 'ping':
      sendResponse({ success: true, recording: recorder.isRecording });
      break;
  }
});