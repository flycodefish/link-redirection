// 转发快捷键命令到当前活动标签页的 content script
chrome.commands && chrome.commands.onCommand.addListener((command) => {
	if (command === 'toggle-text-links') {
		chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
			if (tabs && tabs[0] && tabs[0].id) {
				chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleTextLinks' }, () => {});
			}
		});
	}
});

// 可选：在安装时设置默认值
chrome.runtime && chrome.runtime.onInstalled && chrome.runtime.onInstalled.addListener(() => {
	chrome.storage.sync.get(['textLinksEnabled'], (result) => {
		if (typeof result.textLinksEnabled === 'undefined') {
			chrome.storage.sync.set({ textLinksEnabled: true });
		}
	});
});

// 监听来自 content script 的请求（如通过 background 创建新标签以打开链接）
chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (!message || !message.action) return;

	if (message.action === 'openUrl' && message.url) {
		try {
			chrome.tabs.create({ url: message.url }, () => {
				sendResponse({ opened: true });
			});
			return true; // will respond asynchronously
		} catch (err) {
			console.error('background: failed to open url', err);
			sendResponse({ opened: false, error: String(err) });
		}
	}
});
