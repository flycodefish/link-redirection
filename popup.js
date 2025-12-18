document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggleEnabled');
  const processBtn = document.getElementById('processCurrent');
  const statsEl = document.getElementById('stats');
  
  // 获取当前状态
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    try {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getStatus' }, (response) => {
        if (chrome.runtime.lastError) {
          // content script 可能未注入（比如受限页面），保持默认并显示信息
          console.warn('popup.getStatus error', chrome.runtime.lastError.message);
          updateStats();
          return;
        }
        if (response) {
          toggle.checked = response.enabled;
        }
        updateStats();
      });
    } catch (err) {
      console.warn('popup: failed to get status', err);
      updateStats();
    }
  });
  
  // 切换开关
  toggle.addEventListener('change', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleTextLinks' }, (response) => {
        if (chrome.runtime.lastError) {
          showMessage('页面无法通信：' + chrome.runtime.lastError.message);
        } else {
          updateStats();
        }
      });
    });
  });
  
  // 重新扫描按钮
  processBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'processPage' }, (response) => {
        if (chrome.runtime.lastError) {
          showMessage('页面无法通信：' + chrome.runtime.lastError.message);
          return;
        }
        if (response) {
          updateStats();
          showMessage('页面已重新扫描');
        }
      });
    });
  });
  
  function updateStats() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs && tabs[0] && tabs[0].id;
      if (!tabId) {
        statsEl.textContent = '无法定位当前标签';
        return;
      }

      // 优先使用 chrome.scripting（需要在 manifest 中声明 permission），若不可用则回退至 content script 消息接口
      if (chrome.scripting && chrome.scripting.executeScript) {
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const buttons = document.querySelectorAll('.text-link-button');
            const highlighted = document.querySelectorAll('.highlighted-url');
            return {
              buttons: buttons.length,
              urls: highlighted.length
            };
          }
        }, (results) => {
          if (chrome.runtime.lastError) {
            statsEl.textContent = '无法统计：' + chrome.runtime.lastError.message;
            return;
          }
          if (results && results[0] && results[0].result) {
            const { buttons, urls } = results[0].result;
            statsEl.textContent = `已发现 ${urls} 个URL，添加了 ${buttons} 个按钮`;
          }
        });
      } else {
        // 回退给 content script，要求 content script 返回统计数据（实现于 content.js）
        chrome.tabs.sendMessage(tabId, { action: 'getStats' }, (response) => {
          if (chrome.runtime.lastError) {
            statsEl.textContent = '无法统计：' + chrome.runtime.lastError.message;
            return;
          }
          if (response && typeof response.buttons !== 'undefined') {
            statsEl.textContent = `已发现 ${response.urls} 个URL，添加了 ${response.buttons} 个按钮`;
          } else {
            statsEl.textContent = '无法获取统计数据';
          }
        });
      }
    });
  }
  
  function showMessage(text) {
    const message = document.createElement('div');
    message.textContent = text;
    message.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #4CAF50;
      color: white;
      padding: 10px 20px;
      border-radius: 6px;
      z-index: 10000;
    `;
    document.body.appendChild(message);
    setTimeout(() => message.remove(), 2000);
  }
  
  // 初始更新
  updateStats();
});