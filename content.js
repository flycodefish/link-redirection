class TextLinkOpener {
  constructor() {
    this.isEnabled = true;
    // 使用非全局正则作为模板；在每次匹配时创建带 `g` 的实例以避免 lastIndex 问题
    this.urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;
    this.processedElements = new WeakSet();
    this.buttons = new Set();
    
    this.init();
  }
  
  init() {
    // 加载设置
    chrome.storage.sync.get(['textLinksEnabled'], (result) => {
      this.isEnabled = result.textLinksEnabled !== false;
      if (this.isEnabled) {
        this.scanAndProcess();
        this.startObserver();
      }
    });
    
    // 监听消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'toggleTextLinks') {
        this.toggle();
        sendResponse({ enabled: this.isEnabled });
      } else if (request.action === 'getStatus') {
        sendResponse({ enabled: this.isEnabled });
      } else if (request.action === 'getStats') {
        // 返回当前页面统计（按钮数量与高亮URL数量）
        try {
          const buttons = document.querySelectorAll('.text-link-button');
          const highlighted = document.querySelectorAll('.highlighted-url');
          sendResponse({ buttons: buttons.length, urls: highlighted.length });
        } catch (err) {
          sendResponse({ buttons: 0, urls: 0 });
        }
      } else if (request.action === 'processPage') {
        this.scanAndProcess();
        sendResponse({ processed: true });
      }
    });
    
    // 监听快捷键
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && e.key === 'L') {
        this.toggle();
      }
    });
  }
  
  toggle() {
    this.isEnabled = !this.isEnabled;
    chrome.storage.sync.set({ textLinksEnabled: this.isEnabled });
    
    if (this.isEnabled) {
      this.scanAndProcess();
      this.startObserver();
      this.showNotification('文本链接按钮已启用');
    } else {
      // 先停止 observer，避免在移除节点时触发重新处理导致循环
      this.stopObserver();
      this.removeButtons();
      this.showNotification('文本链接按钮已禁用');
    }
  }
  
  scanAndProcess() {
    // 扫描整个文档
    this.processNode(document.body);
    
    // 特别处理代码块
    this.processCodeBlocks();
  }
  
  processNode(node) {
    // 如果是元素节点且是由本扩展插入的元素（按钮、tooltip、菜单、高亮），跳过
    if (node.nodeType === Node.ELEMENT_NODE) {
      try {
        if (node.matches && node.matches('.text-link-button, .text-link-tooltip, .text-link-menu, .highlighted-url')) {
          return;
        }
      } catch (err) {
        // 某些节点在跨 iframe/特殊环境下 matches 可能抛错，忽略并继续
      }
    }

    // 跳过已处理的元素
    if (this.processedElements.has(node)) return;
    this.processedElements.add(node);

    // 如果是文本节点
    if (node.nodeType === Node.TEXT_NODE) {
      this.processTextNode(node);
      return;
    }

    // 如果是元素节点，跳过已有的链接
    if (node.nodeType === Node.ELEMENT_NODE) {
      // 跳过已有的<a>标签
      if (node.tagName === 'A') return;

      // 跳过某些不需要的元素
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || 
          node.tagName === 'BUTTON' || node.tagName === 'INPUT') {
        return;
      }

      // 处理子节点
      for (let child of node.childNodes) {
        this.processNode(child);
      }
    }
  }
  
  processTextNode(textNode) {
    const text = textNode.textContent;
    if (!text) return;

    // 使用基于 source 的全局正则来获取所有匹配项，避免复用带有 lastIndex 的全局正则
    const urls = text.match(new RegExp(this.urlRegex.source, 'g'));
    
    if (!urls || urls.length === 0) return;
    
    const parent = textNode.parentNode;
    if (!parent) return;
    
    // 创建一个文档片段来替换
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    
    urls.forEach((url, index) => {
      const urlIndex = text.indexOf(url, lastIndex);
      
      // 添加URL前的文本
      if (urlIndex > lastIndex) {
        fragment.appendChild(
          document.createTextNode(text.substring(lastIndex, urlIndex))
        );
      }
      
      // 创建URL包裹元素
      const urlSpan = document.createElement('span');
      urlSpan.className = 'highlighted-url';
      
      const urlText = document.createTextNode(url);
      urlSpan.appendChild(urlText);
      fragment.appendChild(urlSpan);
      
      // 添加按钮
      const button = this.createButton(url);
      fragment.appendChild(button);
      
      lastIndex = urlIndex + url.length;
    });
    
    // 添加剩余文本
    if (lastIndex < text.length) {
      fragment.appendChild(
        document.createTextNode(text.substring(lastIndex))
      );
    }
    
    // 替换原文本节点
    parent.replaceChild(fragment, textNode);
  }
  
  processCodeBlocks() {
    // 特别处理代码块（如pre, code元素）
    const codeElements = document.querySelectorAll('pre, code, .code, .syntaxhighlighter');
    
    codeElements.forEach(element => {
      if (this.processedElements.has(element)) return;
      this.processedElements.add(element);
      
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      
      let node;
      const nodes = [];
      while (node = walker.nextNode()) {
        if (this.urlRegex.test(node.textContent)) {
          nodes.push(node);
        }
      }
      
      nodes.forEach(node => this.processTextNode(node));
    });
  }
  
  createButton(url) {
    const button = document.createElement('button');
    button.className = 'text-link-button';
    button.title = `点击打开: ${url}`;
    button.dataset.url = url;
    
    // 添加简短标签
    const urlObj = new URL(url);
    let label = '打开';
    if (urlObj.hostname.includes('doi.org')) label = 'DOI';
    else if (urlObj.hostname.includes('arxiv')) label = 'arXiv';
    else if (urlObj.hostname.includes('github')) label = 'GitHub';
    else if (urlObj.hostname.includes('youtube')) label = '视频';
    
    button.textContent = label;
    
    // 点击事件
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openUrl(url, button);
    });
    
    // 右键菜单
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showButtonMenu(e, url, button);
    });
    
    // 悬停提示
    this.addButtonHover(button, url);
    
    this.buttons.add(button);
    return button;
  }
  
  addButtonHover(button, url) {
    let tooltip = null;
    let timeout = null;
    
    button.addEventListener('mouseenter', (e) => {
      timeout = setTimeout(() => {
        tooltip = document.createElement('div');
        tooltip.className = 'text-link-tooltip';
        tooltip.textContent = url;
        
        const rect = button.getBoundingClientRect();
        tooltip.style.position = 'fixed';
        tooltip.style.top = `${rect.top - 35}px`;
        tooltip.style.left = `${rect.left}px`;
        
        document.body.appendChild(tooltip);
        setTimeout(() => tooltip.classList.add('show'), 10);
      }, 300);
    });
    
    button.addEventListener('mouseleave', () => {
      clearTimeout(timeout);
      if (tooltip) {
        tooltip.classList.remove('show');
        setTimeout(() => {
          if (tooltip && tooltip.parentNode) {
            tooltip.parentNode.removeChild(tooltip);
          }
        }, 200);
      }
    });
  }
  
  openUrl(url, button) {
    // 尝试通过 background 创建新标签（更稳定，避免被页面拦截）
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'openUrl', url }, (resp) => {
        if (chrome.runtime.lastError) {
          // 回退到 window.open
          window.open(url, '_blank');
        }

        // 按钮反馈效果
        const originalHTML = button.innerHTML;
        const originalBg = button.style.background;
        button.innerHTML = '✓ 已打开';
        button.style.background = 'linear-gradient(135deg, #4CAF50 0%, #2E7D32 100%)';
        button.style.opacity = '0.9';

        setTimeout(() => {
          button.innerHTML = originalHTML;
          button.style.background = originalBg;
          button.style.opacity = '';
        }, 1500);
      });
    } else {
      // 兜底
      window.open(url, '_blank');
    }
  }
  
  showButtonMenu(e, url, button) {
    e.preventDefault();
    
    const menu = document.createElement('div');
    menu.className = 'text-link-menu';
    menu.style.cssText = `
      position: fixed;
      top: ${e.clientY}px;
      left: ${e.clientX}px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10002;
      min-width: 180px;
    `;
    
    const options = [
      { text: '在新标签页打开', icon: '🔗', action: () => this.openUrl(url, button) },
      { text: '在新窗口打开', icon: '🪟', action: () => window.open(url, '_blank', 'width=1200,height=800') },
      { text: '复制链接地址', icon: '📋', action: () => navigator.clipboard.writeText(url) },
      { text: '复制Markdown链接', icon: '📝', action: () => {
        const title = document.title || '链接';
        navigator.clipboard.writeText(`[${title}](${url})`);
      }},
      { text: '禁用此网站', icon: '🚫', action: () => this.disableForCurrentSite() }
    ];
    
    options.forEach(option => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 8px 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: background 0.2s;
      `;
      item.innerHTML = `<span>${option.icon}</span><span>${option.text}</span>`;
      
      item.onmouseenter = () => item.style.background = '#f5f5f5';
      item.onmouseleave = () => item.style.background = '';
      item.onclick = () => {
        option.action();
        if (menu.parentNode) {
          menu.parentNode.removeChild(menu);
        }
      };
      
      menu.appendChild(item);
    });
    
    document.body.appendChild(menu);
    
    // 点击其他地方关闭菜单
    setTimeout(() => {
      const closeMenu = (clickEvent) => {
        if (!menu.contains(clickEvent.target)) {
          if (menu.parentNode) {
            menu.parentNode.removeChild(menu);
          }
          document.removeEventListener('click', closeMenu);
        }
      };
      document.addEventListener('click', closeMenu);
    }, 0);
  }
  
  disableForCurrentSite() {
    const hostname = window.location.hostname;
    chrome.storage.sync.get(['disabledSites'], (result) => {
      const disabledSites = result.disabledSites || [];
      if (!disabledSites.includes(hostname)) {
        disabledSites.push(hostname);
        chrome.storage.sync.set({ disabledSites });
        this.removeButtons();
        this.showNotification(`已禁用 ${hostname} 的链接按钮`);
      }
    });
  }
  
  startObserver() {
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.processNode(node);
          }
        });
      });
    });
    
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  stopObserver() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }
  
  removeButtons() {
    // 暂停 observer，防止在替换节点时触发 mutation 回调造成重新添加按钮的循环
    const wasObserving = !!this.observer;
    if (wasObserving) {
      this.observer.disconnect();
    }

    this.buttons.forEach(button => {
      if (button.parentNode) {
        button.parentNode.removeChild(button);
      }
    });
    this.buttons.clear();

    // 移除高亮样式（用纯文本替换），先做存在性检查以防错误
    document.querySelectorAll('.highlighted-url').forEach(el => {
      try {
        const text = el.textContent;
        const textNode = document.createTextNode(text);
        if (el.parentNode) {
          el.parentNode.replaceChild(textNode, el);
        }
      } catch (err) {
        // 忽略个别替换错误，不要中断整个移除流程
        console.warn('替换 highlighted-url 时出错', err);
      }
    });

    // 重置已处理集合，保证在再次启用或重新扫描时能处理之前已处理过的节点
    try {
      this.processedElements = new WeakSet();
    } catch (err) {
      console.warn('重置 processedElements 失败', err);
    }

    // 如果之前正在观察并且当前仍然启用，则恢复 observer
    if (wasObserving && this.isEnabled) {
      this.startObserver();
    }
  }
  
  showNotification(message) {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 10000;
      animation: slideInRight 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 2000);
  }
}

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOutRight {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);

// 初始化
const textLinkOpener = new TextLinkOpener();