// 密码保护功能

/**
 * 检查是否设置了密码保护
 * 通过读取页面上嵌入的环境变量来检查
 */
// 旧部署平台（CF/Netlify/Vercel）仍把 sha256(PASSWORD) 内联进 HTML；
// Node/Docker 部署不再内联哈希，只注入 PASSWORD_PROTECTED 布尔值。
function legacyInlineHash() {
    const pwd = window.__ENV__ && window.__ENV__.PASSWORD;
    return (typeof pwd === 'string' && pwd.length === 64 && !/^0+$/.test(pwd)) ? pwd : null;
}

function isPasswordProtected() {
    if (legacyInlineHash()) return true;
    return !!(window.__ENV__ && window.__ENV__.PASSWORD_PROTECTED === 'true');
}

// Node/Docker 部署：凭据在 HttpOnly Cookie 里（前端读不到、URL 里也没有）
function isCookieMode() {
    return !!(window.__ENV__ && window.__ENV__.PASSWORD_PROTECTED === 'true');
}

/**
 * 检查是否强制要求设置密码
 * 如果没有设置有效的 PASSWORD，则认为需要强制设置密码
 * 为了安全考虑，所有部署都必须设置密码
 */
function isPasswordRequired() {
    return !isPasswordProtected();
}

/**
 * 强制密码保护检查 - 防止绕过
 * 在关键操作前都应该调用此函数
 */
function ensurePasswordProtection() {
    if (isPasswordRequired()) {
        showPasswordModal();
        throw new Error('Password protection is required');
    }
    if (isPasswordProtected() && !isPasswordVerified()) {
        showPasswordModal();
        throw new Error('Password verification required');
    }
    return true;
}

window.isPasswordProtected = isPasswordProtected;
window.isPasswordRequired = isPasswordRequired;

/**
 * 验证用户输入的密码是否正确（异步，使用SHA-256哈希）
 */
async function verifyPassword(password) {
    try {
        if (!isPasswordProtected()) return false;

        if (isCookieMode()) {
            // Node/Docker：密码只发给服务端校验（定时安全比较 + 限速），
            // 服务端用 HttpOnly Cookie 下发会话令牌 —— 前端拿不到，URL 里也没有。
            const resp = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password })
            });
            if (!resp.ok) return false;
            const data = await resp.json();
            if (!data || data.ok !== true) return false;

            localStorage.setItem(PASSWORD_CONFIG.localStorageKey, JSON.stringify({
                verified: true,
                timestamp: Date.now(),
                mode: 'cookie'
            }));
            return true;
        }

        // 旧平台（CF/Netlify/Vercel）：页面内联了哈希，本地对比
        const authHash = legacyInlineHash();
        if (!authHash) return false;
        const inputHash = await sha256(password);
        if (inputHash !== authHash) return false;

        localStorage.setItem(PASSWORD_CONFIG.localStorageKey, JSON.stringify({
            verified: true,
            timestamp: Date.now(),
            passwordHash: authHash
        }));
        return true;
    } catch (error) {
        console.error('验证密码时出错:', error);
        return false;
    }
}

// 验证状态检查
function isPasswordVerified() {
    try {
        if (!isPasswordProtected()) return true;

        const stored = localStorage.getItem(PASSWORD_CONFIG.localStorageKey);
        if (!stored) return false;

        const parsed = JSON.parse(stored);
        const timestamp = parsed.timestamp;

        if (!timestamp || Date.now() - timestamp >= PASSWORD_CONFIG.verificationTTL) {
            return false;
        }

        // Cookie 模式：本地只存「已验证」标记，真凭据在 HttpOnly Cookie 里，
        // 页面启动时用 /api/session 复核（见 checkServerSession）。
        if (isCookieMode()) return parsed.verified === true;

        return typeof parsed.passwordHash === 'string' && parsed.passwordHash.length === 64;
    } catch (error) {
        console.error('检查密码验证状态时出错:', error);
        return false;
    }
}

// 更新全局导出
window.isPasswordProtected = isPasswordProtected;
window.isPasswordRequired = isPasswordRequired;
window.isPasswordVerified = isPasswordVerified;
window.verifyPassword = verifyPassword;
window.checkServerSession = checkServerSession;
window.ensurePasswordProtection = ensurePasswordProtection;

// SHA-256实现，可用Web Crypto API
async function sha256(message) {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // HTTP 下调用原始 js‑sha256
    if (typeof window._jsSha256 === 'function') {
        return window._jsSha256(message);
    }
    throw new Error('No SHA-256 implementation available.');
}

/**
 * 显示密码验证弹窗
 */
function showPasswordModal() {
    const passwordModal = document.getElementById('passwordModal');
    if (passwordModal) {
        // 防止出现豆瓣区域滚动条
        document.getElementById('doubanArea').classList.add('hidden');
        document.getElementById('passwordCancelBtn').classList.add('hidden');

        // 检查是否需要强制设置密码
        if (isPasswordRequired()) {
            // 修改弹窗内容提示用户需要先设置密码
            const title = passwordModal.querySelector('h2');
            const description = passwordModal.querySelector('p');
            if (title) title.textContent = '需要设置密码';
            if (description) description.textContent = '请先在部署平台设置 PASSWORD 环境变量来保护您的实例';
            
            // 隐藏密码输入框和提交按钮，只显示提示信息
            const form = passwordModal.querySelector('form');
            const errorMsg = document.getElementById('passwordError');
            if (form) form.style.display = 'none';
            if (errorMsg) {
                errorMsg.textContent = '为确保安全，必须设置 PASSWORD 环境变量才能使用本服务，请联系管理员进行配置';
                errorMsg.classList.remove('hidden');
                errorMsg.className = 'text-red-500 mt-2 font-medium'; // 改为更醒目的红色
            }
        } else {
            // 正常的密码验证模式
            const title = passwordModal.querySelector('h2');
            const description = passwordModal.querySelector('p');
            if (title) title.textContent = '访问验证';
            if (description) description.textContent = '请输入密码继续访问';
            
            const form = passwordModal.querySelector('form');
            if (form) form.style.display = 'block';
        }

        passwordModal.style.display = 'flex';

        // 只有在非强制设置密码模式下才聚焦输入框
        if (!isPasswordRequired()) {
            // 确保输入框获取焦点
            setTimeout(() => {
                const passwordInput = document.getElementById('passwordInput');
                if (passwordInput) {
                    passwordInput.focus();
                }
            }, 100);
        }
    }
}

/**
 * 隐藏密码验证弹窗
 */
function hidePasswordModal() {
    const passwordModal = document.getElementById('passwordModal');
    if (passwordModal) {
        // 隐藏密码错误提示
        hidePasswordError();

        // 清空密码输入框
        const passwordInput = document.getElementById('passwordInput');
        if (passwordInput) passwordInput.value = '';

        passwordModal.style.display = 'none';

        // 如果启用豆瓣区域则显示豆瓣区域
        if (localStorage.getItem('doubanEnabled') === 'true') {
            document.getElementById('doubanArea').classList.remove('hidden');
            initDouban();
        }
    }
}

/**
 * 显示密码错误信息
 */
function showPasswordError() {
    const errorElement = document.getElementById('passwordError');
    if (errorElement) {
        errorElement.classList.remove('hidden');
    }
}

/**
 * 隐藏密码错误信息
 */
function hidePasswordError() {
    const errorElement = document.getElementById('passwordError');
    if (errorElement) {
        errorElement.classList.add('hidden');
    }
}

/**
 * 处理密码提交事件（异步）
 */
async function handlePasswordSubmit() {
    const passwordInput = document.getElementById('passwordInput');
    const password = passwordInput ? passwordInput.value.trim() : '';
    if (await verifyPassword(password)) {
        hidePasswordModal();

        // 触发密码验证成功事件
        document.dispatchEvent(new CustomEvent('passwordVerified'));
    } else {
        showPasswordError();
        if (passwordInput) {
            passwordInput.value = '';
            passwordInput.focus();
        }
    }
}

/**
 * 初始化密码验证系统
 */
function initPasswordProtection() {
    // 如果需要强制设置密码，显示警告弹窗
    if (isPasswordRequired()) {
        showPasswordModal();
        return;
    }

    // 如果设置了密码但用户未验证，显示密码输入框
    if (isPasswordProtected() && !isPasswordVerified()) {
        showPasswordModal();
        return;
    }

    // 本地标记说「已验证」，但真凭据在 HttpOnly Cookie 里 —— 再跟服务端确认一次。
    // Cookie 过期 / 被清掉 / 换了设备时，清掉本地标记并重新弹窗。
    if (isPasswordProtected()) {
        checkServerSession().then(function (ok) {
            if (!ok) {
                localStorage.removeItem(PASSWORD_CONFIG.localStorageKey);
                showPasswordModal();
            }
        });
    }
}

/**
 * 复核服务端会话（Cookie 模式）
 */
async function checkServerSession() {
    if (!isCookieMode() || !isPasswordProtected()) return true;
    try {
        const resp = await fetch('/api/session', { cache: 'no-store' });
        if (!resp.ok) return false;
        const data = await resp.json();
        return !!(data && data.ok === true);
    } catch (error) {
        console.warn('会话复核失败:', error && error.message);
        return false;
    }
}

// 在页面加载完成后初始化密码保护
document.addEventListener('DOMContentLoaded', function () {
    initPasswordProtection();
});