const CUSTOMER_SITES = {
    iqiyizyapi_com: {
        api: 'https://iqiyizyapi.com/api.php/provide/vod',
        name: '-爱奇艺-',
    },
    dbzy_tv: {
        api: 'https://caiji.dbzy5.com/api.php/provide/vod',
        name: '豆瓣资源',
    },
    mtzy_me: {
        api: 'https://caiji.maotaizy.cc/api.php/provide/vod',
        name: '茅台资源',
    },
    wolongzyw_com: {
        api: 'https://wolongzyw.com/api.php/provide/vod',
        name: '卧龙资源',
    },
    ikunzy_com: {
        api: 'https://ikunzyapi.com/api.php/provide/vod',
        name: 'iKun资源',
    },
    dyttzyapi_com: {
        api: 'http://caiji.dyttzyapi.com/api.php/provide/vod',
        name: '电影天堂',
    },
    www_maoyanzy_com: {
        api: 'https://api.maoyanapi.top/api.php/provide/vod',
        name: '猫眼资源',
    },
    cj_lzcaiji_com: {
        api: 'https://cj.lzcaiji.com/api.php/provide/vod',
        name: '量子资源',
    },
    _360zy_com: {
        api: 'https://360zyzz.com/api.php/provide/vod',
        name: '360 资源',
    },
    jszyapi_com: {
        api: 'https://jszyapi.com/api.php/provide/vod',
        name: '极速资源',
    },
    www_moduzy_net: {
        api: 'https://www.mdzyapi.com/api.php/provide/vod',
        name: '魔都资源',
    },
    ffzyapi_com: {
        api: 'https://api.ffzyapi.com/api.php/provide/vod',
        name: '非凡资源',
    },
    bfzy_tv: {
        api: 'https://bfzyapi.com/api.php/provide/vod',
        name: '暴风资源',
    },
    zuida_xyz: {
        api: 'https://api.zuidapi.com/api.php/provide/vod',
        name: '最大资源',
    },
    wujinzy_me: {
        api: 'https://api.wujinapi.me/api.php/provide/vod',
        name: '无尽资源',
    },
    xinlangapi_com: {
        api: 'https://api.xinlangapi.com/xinlangapi.php/provide/vod',
        name: '新浪资源',
    },
    api_wwzy_tv: {
        api: 'https://api.wwzy.tv/api.php/provide/vod',
        name: '旺旺资源',
    },
    www_subozy_com: {
        api: 'https://subocaiji.com/api.php/provide/vod',
        name: '速播资源',
    },
    jinyingzy_com: {
        api: 'https://jinyingzy.com/api.php/provide/vod',
        name: '金鹰点播',
    },
    p2100_net: {
        api: 'https://p2100.net/api.php/provide/vod',
        name: '飘零资源',
    },
    api_ukuapi88_com: {
        api: 'https://api.ukuapi88.com/api.php/provide/vod',
        name: 'U酷影视',
    },
    api_guangsuapi_com: {
        api: 'https://api.guangsuapi.com/api.php/provide/vod',
        name: '光速资源',
    },
    www_hongniuzy_com: {
        api: 'https://www.hongniuzy2.com/api.php/provide/vod',
        name: '红牛资源',
    },
    caiji_moduapi_cc: {
        api: 'https://caiji.moduapi.cc/api.php/provide/vod',
        name: '魔都动漫',
    },
    www_ryzyw_com: {
        api: 'https://pz.v88.qzz.io/?url=https://cj.rycjapi.com/api.php/provide/vod',
        name: '如意资源',
    },
    www_haohuazy_com: {
        api: 'https://pz.v88.qzz.io/?url=https://hhzyapi.com/api.php/provide/vod',
        name: '豪华资源',
    },
    bdzy1_com: {
        api: 'https://pz.v88.qzz.io/?url=https://api.apibdzy.com/api.php/provide/vod',
        name: '百度云zy',
    },
    lovedan_net: {
        api: 'https://pz.v88.qzz.io/?url=https://lovedan.net/api.php/provide/vod',
        name: '艾旦影视',
    },
    lzizy_net: {
        api: 'https://cj.lziapi.com/api.php/provide/vod',
        name: '量子影视',
    },
    zuidazy_co: {
        api: 'https://zuidazy.me/api.php/provide/vod',
        name: '最大点播',
    },
    wujinzy_com: {
        api: 'https://api.wujinapi.com/api.php/provide/vod',
        name: '无尽影视',
    },
    wwzy_tv: {
        api: 'https://wwzy.tv/api.php/provide/vod',
        name: '旺旺短剧',
    },
    _1080zyk4_com: {
        api: 'https://api.yzzy-api.com/inc/apijson.php',
        name: '优质资源',
    },
    www_huyaapi_com: {
        api: 'https://www.huyaapi.com/api.php/provide/vod',
        name: '虎牙资源',
    },
    yayazy3_com: {
        api: 'https://cj.yayazy.net/api.php/provide/vod',
        name: '鸭鸭资源',
    },
    suonizy_net: {
        api: 'https://suoniapi.com/api.php/provide/vod',
        name: '索尼资源',
    },
    kuaichezy_com: {
        api: 'https://caiji.kuaichezy.org/api.php/provide/vod',
        name: '快车资源',
    },
    shandianzy_com: {
        api: 'https://xsd.sdzyapi.com/api.php/provide/vod',
        name: '闪电资源',
    },
    yhzy_cc: {
        api: 'https://m3u8.apiyhzy.com/api.php/provide/vod',
        name: '樱花资源',
    },
    _91md_me: {
        api: 'https://91md.me/api.php/provide/vod',
        name: '麻豆视频',
    },
    lbapiby_com: {
        api: 'http://lbapiby.com/api.php/provide/vod',
        name: '--AIvin-',
    },
    _155zy2_com: {
        api: 'https://155api.com/api.php/provide/vod',
        name: '155-资源',
    },
    apiyutu_com: {
        api: 'https://apiyutu.com/api.php/provide/vod',
        name: '玉兔资源',
    },
    fhapi9_com: {
        api: 'http://fhapi9.com/api.php/provide/vod',
        name: '番号资源',
    },
    apilsbzy1_com: {
        api: 'https://apilsbzy1.com/api.php/provide/vod',
        name: '-老色逼-',
    },
    www_yytv4_cc: {
        api: 'https://www.yytv4.cc/api.php/provide/vod',
        name: '优优资源',
    },
    xiaojizy_live: {
        api: 'https://api.xiaojizy.live/provide/vod',
        name: '小鸡资源',
    },
    hsckzy_xyz: {
        api: 'https://hsckzy.xyz/api.php/provide/vod',
        name: '黄色仓库',
    },
    apidanaizi_com: {
        api: 'https://apidanaizi.com/api.php/provide/vod',
        name: '-大奶子-',
    },
    jkunzyapi_com: {
        api: 'https://jkunzyapi.com/api.php/provide/vod',
        name: 'jkun资源',
    },
    lbapi9_com: {
        api: 'https://lbapi9.com/api.php/provide/vod',
        name: '乐播资源',
    },
    Naixxzy_com: {
        api: 'https://Naixxzy.com/api.php/provide/vod',
        name: '奶香资源',
    },
    slapibf_com: {
        api: 'https://beiyong.slapibf.com/api.php/provide/vod',
        name: '森林资源',
    },
    apilj_com: {
        api: 'https://pz.v88.qzz.io/?url=https://apilj.com/api.php/provide/vod',
        name: '辣椒资源',
    },
    shayuapi_com: {
        api: 'https://shayuapi.com/api.php/provide/vod',
        name: '鲨鱼资源',
    },
    doudouzy_com: {
        api: 'https://api.douapi.cc/api.php/provide/vod',
        name: '豆豆资源',
    },
    didizy_com: {
        api: 'https://api.ddapi.cc/api.php/provide/vod',
        name: '滴滴资源',
    },
    heiliaozy_cc: {
        api: 'https://www.heiliaozyapi.com/api.php/provide/vod',
        name: '黑料资源',
    },
    api_bwzym3u8_com: {
        api: 'https://api.bwzyz.com/api.php/provide/vod',
        name: '百万资源',
    },
    thzy8_me: {
        api: 'https://thzy1.me/api.php/provide/vod',
        name: '桃花资源',
    },
    www_jingpinx_com: {
        api: 'https://www.jingpinx.com/api.php/provide/vod',
        name: '精品资源',
    },
    ckzy_me: {
        api: 'https://ckzy.me/api.php/provide/vod',
        name: ' CK-资源',
    },
    souavzyw_com: {
        api: 'https://api.souavzyw.net/api.php/provide/vod',
        name: 'souavZY',
    },
    www_xxibaozyw_com: {
        api: 'https://www.xxibaozyw.com/api.php/provide/vod',
        name: '细胞资源',
    },
    xiangjiaozyw_com: {
        api: 'https://www.xiangjiaozyw.com/api.php/provide/vod',
        name: '香蕉资源',
    },
    www_msnii_com: {
        api: 'https://www.msnii.com/api/json.php',
        name: '-美少女-',
    },
    www_pgxdy_com: {
        api: 'https://www.pgxdy.com/api/json.php',
        name: '-黄AVZY',
    },
    www_kxgav_com: {
        api: 'https://www.kxgav.com/api/json.php',
        name: '白嫖资源',
    },
    xingba111_com: {
        api: 'https://xingba222.com/api.php/provide/vod',
        name: '杏吧资源',
    },
    dadizy11_com: {
        api: 'https://dadiapi.com/feifei',
        name: '大地资源',
    },
    semaozy1_com: {
        api: 'https://caiji.semaozy.net/inc/apijson_vod.php/provide/vod',
        name: '色猫资源',
    },
    aosikazy_com: {
        api: 'https://aosikazy.com/api.php/provide/vod',
        name: '-奥斯卡-',
    },
    siwazyw_tv: {
        api: 'https://siwazyw.tv/api.php/provide/vod',
        name: '丝袜资源',
    }
};

// 调用全局方法合并
if (window.extendAPISites) {
    window.extendAPISites(CUSTOMER_SITES);
} else {
    console.error("错误：请先加载 config.js！");
}
