/**
 * 代理请求鉴权模块
 * 为代理请求添加基于 PASSWORD 的鉴权机制
 */

// 从全局配置获取密码哈希（如果存在）
let cachedPasswordHash = null;

/**
 * 获取当前会话的密码哈希
 */
async function getPasswordHash() {
    // Cookie 模式（Node/Docker）：凭据在 HttpOnly Cookie 里，前端既拿不到也不需要，
    // 代理 URL 不再携带任何令牌 —— 也就不会漏进历史/日志/Referer。
    if (window.__ENV__ && window.__ENV__.PASSWORD_PROTECTED === 'true') {
        return null;
    }
    if (cachedPasswordHash) {
        return cachedPasswordHash;
    }
    
    // 1. 优先使用「密码验证成功后」存下来的令牌。
    //    password.js 写入；Node/Docker 部署下由 POST /api/login 下发，
    //    页面里不再内联哈希。
    try {
        const key = (window.PASSWORD_CONFIG && window.PASSWORD_CONFIG.localStorageKey) || 'passwordVerified';
        const stored = localStorage.getItem(key);
        if (stored) {
            const parsed = JSON.parse(stored);
            const ttl = (window.PASSWORD_CONFIG && window.PASSWORD_CONFIG.verificationTTL) ||
                90 * 24 * 60 * 60 * 1000;
            if (parsed && parsed.timestamp && typeof parsed.passwordHash === 'string' &&
                parsed.passwordHash.length === 64 && Date.now() - parsed.timestamp < ttl) {
                cachedPasswordHash = parsed.passwordHash;
                return parsed.passwordHash;
            }
        }
    } catch (error) {
        console.error('读取本地鉴权令牌失败:', error);
    }

    // 2. 兼容旧的独立缓存键
    const storedHash = localStorage.getItem('proxyAuthHash');
    if (storedHash) {
        cachedPasswordHash = storedHash;
        return storedHash;
    }

    // 3. 兼容「缓存了明文密码」的旧版本
    const userPassword = localStorage.getItem('userPassword');
    if (userPassword) {
        try {
            // [旧引擎/HTTP] 不用动态模块导入（旧 WebKit 与 Chrome 44 都不支持），
            // 也不用 crypto.subtle（仅安全上下文可用），直接用页面已加载的纯 JS 实现。
            const sha256Fn = window._jsSha256 || window.libretvSha256 || window.sha256;
            const hash = await sha256Fn(userPassword);
            localStorage.setItem('proxyAuthHash', hash);
            cachedPasswordHash = hash;
            return hash;
        } catch (error) {
            console.error('生成密码哈希失败:', error);
        }
    }

    // 4. 旧部署平台（CF/Netlify/Vercel）仍把哈希内联在页面里
    if (window.__ENV__ && typeof window.__ENV__.PASSWORD === 'string' &&
        window.__ENV__.PASSWORD.length === 64) {
        cachedPasswordHash = window.__ENV__.PASSWORD;
        return window.__ENV__.PASSWORD;
    }

    return null;
}

/**
 * 为代理请求URL添加鉴权参数
 */
async function addAuthToProxyUrl(url) {
    try {
        const hash = await getPasswordHash();
        if (!hash) {
            console.warn('无法获取密码哈希，代理请求可能失败');
            return url;
        }
        
        // 添加时间戳防止重放攻击
        const timestamp = Date.now();
        
        // 检查URL是否已包含查询参数
        const separator = url.includes('?') ? '&' : '?';
        
        return `${url}${separator}auth=${encodeURIComponent(hash)}&t=${timestamp}`;
    } catch (error) {
        console.error('添加代理鉴权失败:', error);
        return url;
    }
}

/**
 * 验证代理请求的鉴权
 */
function validateProxyAuth(authHash, serverPasswordHash, timestamp) {
    if (!authHash || !serverPasswordHash) {
        return false;
    }
    
    // 验证哈希是否匹配
    if (authHash !== serverPasswordHash) {
        return false;
    }
    
    // 验证时间戳（10分钟有效期）
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10分钟
    
    if (timestamp && (now - parseInt(timestamp)) > maxAge) {
        console.warn('代理请求时间戳过期');
        return false;
    }
    
    return true;
}

/**
 * 清除缓存的鉴权信息
 */
function clearAuthCache() {
    cachedPasswordHash = null;
    localStorage.removeItem('proxyAuthHash');
}

// 监听密码变化，清除缓存
window.addEventListener('storage', (e) => {
    if (e.key === 'userPassword' || (window.PASSWORD_CONFIG && e.key === window.PASSWORD_CONFIG.localStorageKey)) {
        clearAuthCache();
    }
});

// 导出函数
window.ProxyAuth = {
    addAuthToProxyUrl,
    validateProxyAuth,
    clearAuthCache,
    getPasswordHash
};
