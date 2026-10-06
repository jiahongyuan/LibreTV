// 只做一件事：把 HTML 里的占位符换成运行期值。
// ⚠️ 绝不把 sha256(PASSWORD) 注入页面 —— 那东西是 /proxy 的鉴权令牌，
//    内联等于把代理令牌公开给任何访客。这里只给一个布尔值，
//    真正的凭据由 POST /api/login 校验密码后以 HttpOnly Cookie 下发。
export async function onRequest(context) {
  const { request, env, next } = context;
  const response = await next();
  const contentType = response.headers.get("content-type") || "";
  
  if (contentType.includes("text/html")) {
    let html = await response.text();
    
    html = html.replace('{{PASSWORD_PROTECTED}}', env.PASSWORD ? 'true' : 'false');
    // 兼容其它部署平台（它们的中间件仍会替换这个占位符）；Pages 端一律留空
    html = html.replace('window.__ENV__.PASSWORD = "{{PASSWORD}}";',
      'window.__ENV__.PASSWORD = "";');
    
    return new Response(html, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
  
  return response;
}