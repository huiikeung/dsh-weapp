// ASCF 元服务须在 HarmonyOS 开发者中心配置此 HTTPS 服务域名和相应 WSS 中继域名。
// 本地 ws 仅用于局域网开发调试；发布前关闭 allowLocalWs，并只使用已备案 WSS。
// ASCF 源码中仅保存公开服务地址；Client Secret、管理员身份和签名材料只能留在服务端/本地签名环境。
module.exports = { baseUrl: 'https://dsh.ahwe.top', allowLocalWs: true };
