// ⚠️ 本文件由精选源清单生成，请勿手工修改。
// 生成时间：2026-10-31T03:22:23.532Z（共 20 个源）
// 排序依据：两轮实测平均延迟（浏览器→CF 边缘→源站）

const CUSTOMER_SITES = {
    ikunzyapi_com: {
        "api": "https://ikunzyapi.com/api.php/provide/vod",
        "name": "iKun资源"
    },
    caiji_dyttzyapi_com: {
        "api": "http://caiji.dyttzyapi.com/api.php/provide/vod",
        "name": "电影天堂"
    },
    caiji_moduapi_cc: {
        "api": "https://caiji.moduapi.cc/api.php/provide/vod",
        "name": "魔都动漫"
    },
    api_guangsuapi_com: {
        "api": "https://api.guangsuapi.com/api.php/provide/vod",
        "name": "光速资源"
    },
    www_hongniuzy2_com: {
        "api": "https://www.hongniuzy2.com/api.php/provide/vod",
        "name": "红牛资源"
    },
    api_ffzyapi_com: {
        "api": "https://api.ffzyapi.com/api.php/provide/vod",
        "name": "非凡资源"
    },
    www_mdzyapi_com: {
        "api": "https://www.mdzyapi.com/api.php/provide/vod",
        "name": "魔都资源"
    },
    jszyapi_com: {
        "api": "https://jszyapi.com/api.php/provide/vod",
        "name": "极速资源"
    },
    subocaiji_com: {
        "api": "https://subocaiji.com/api.php/provide/vod",
        "name": "速播资源"
    },
    hhzyapi_com: {
        "api": "https://hhzyapi.com/api.php/provide/vod",
        "name": "豪华资源"
    },
    www_huyaapi_com: {
        "api": "https://www.huyaapi.com/api.php/provide/vod",
        "name": "虎牙资源"
    },
    api_yzzy_api_com: {
        "api": "https://api.yzzy-api.com/inc/apijson.php",
        "name": "优质资源"
    },
    api_xinlangapi_com: {
        "api": "https://api.xinlangapi.com/xinlangapi.php/provide/vod",
        "name": "新浪资源"
    },
    _360zyzz_com: {
        "api": "https://360zyzz.com/api.php/provide/vod",
        "name": "360 资源"
    },
    api_maoyanapi_top: {
        "api": "https://api.maoyanapi.top/api.php/provide/vod",
        "name": "猫眼资源"
    },
    cj_rycjapi_com: {
        "api": "https://cj.rycjapi.com/api.php/provide/vod",
        "name": "如意资源"
    },
    api_apibdzy_com: {
        "api": "https://api.apibdzy.com/api.php/provide/vod",
        "name": "百度云zy"
    },
    cj_lzcaiji_com: {
        "api": "https://cj.lzcaiji.com/api.php/provide/vod",
        "name": "量子资源"
    },
    cj_lziapi_com: {
        "api": "https://cj.lziapi.com/api.php/provide/vod",
        "name": "量子影视"
    },
    api_ukuapi88_com: {
        "api": "https://api.ukuapi88.com/api.php/provide/vod",
        "name": "U酷影视"
    }
};

// 默认勾选：延迟最低的 8 个源
const DEFAULT_SELECTED_APIS = ["ikunzyapi_com","caiji_dyttzyapi_com","caiji_moduapi_cc","api_guangsuapi_com","www_hongniuzy2_com","api_ffzyapi_com","www_mdzyapi_com","jszyapi_com"];

// 合并到全局
window.extendAPISites(CUSTOMER_SITES);
window.DEFAULT_SELECTED_APIS = DEFAULT_SELECTED_APIS;
