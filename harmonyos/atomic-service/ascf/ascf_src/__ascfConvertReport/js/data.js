let pageData = {
  "transforms": {
    "app.js": {
      "status": 1,
      "components": [
        {
          "name": "has.onMemoryWarning",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-memory#hasonmemorywarning",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "app.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "app.miniapp.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "app.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "components/dsh-switch/dsh-switch.js": {
      "status": 3,
      "components": [
        {
          "name": "has.onThemeChange",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.offThemeChange",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        }
      ],
      "type": "jsModular"
    },
    "components/dsh-switch/dsh-switch.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "components/dsh-switch/dsh-switch.hxml": {
      "status": 1,
      "components": [
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        }
      ],
      "type": "templete"
    },
    "components/dsh-switch/dsh-switch.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "components/ocean-background/ocean-background.js": {
      "status": 3,
      "components": [
        {
          "name": "has.createOffscreenCanvas",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.getDeviceInfo",
          "attrs": [
            "返回值缺少：abi, deviceAbi, benchmarkLevel, cpuType,"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetdeviceinfo",
          "status": 2
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "components/ocean-background/ocean-background.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "components/ocean-background/ocean-background.hxml": {
      "status": 2,
      "components": [
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "components/ocean-background/ocean-background.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "components/privacy-sheet/privacy-sheet.js": {
      "status": 3,
      "components": [
        {
          "name": "has.getWindowInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetwindowinfo",
          "status": 1
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.getMenuButtonBoundingClientRect",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-menu#hasgetmenubuttonboundingclientrect",
          "status": 1
        },
        {
          "name": "has.openPrivacyContract",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "components/privacy-sheet/privacy-sheet.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "components/privacy-sheet/privacy-sheet.hxml": {
      "status": 2,
      "components": [
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "components/privacy-sheet/privacy-sheet.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "components/public-access-dialog/public-access-dialog.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "components/public-access-dialog/public-access-dialog.hxml": {
      "status": 2,
      "components": [
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "components/public-access-dialog/public-access-dialog.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "components/voice-overlay/voice-overlay.js": {
      "status": 2,
      "components": [
        {
          "name": "has.getWindowInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetwindowinfo",
          "status": 1
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.nextTick",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-custom-components#hasnexttick",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "components/voice-overlay/voice-overlay.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "components/voice-overlay/voice-overlay.hxml": {
      "status": 2,
      "components": [
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "canvas",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-canvas",
          "attrs": [],
          "status": 1
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "components/voice-overlay/voice-overlay.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/add-node/add-node.js": {
      "status": 2,
      "components": [
        {
          "name": "has.getWindowInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetwindowinfo",
          "status": 1
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.getMenuButtonBoundingClientRect",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-menu#hasgetmenubuttonboundingclientrect",
          "status": 1
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        },
        {
          "name": "has.setClipboardData",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-clipboard#hassetclipboarddata",
          "status": 1
        },
        {
          "name": "has.scanCode",
          "attrs": [
            "success回调函数参数属性缺失：charSet;path;rawData",
            "success回调函数参数属性缺失：charSet;path;rawData"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-scan#hasscancode",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/add-node/add-node.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/add-node/add-node.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "textarea",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-textarea",
          "attrs": [
            "auto-focus",
            "cursor-spacing",
            "cursor",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "disable-default-padding",
            "confirm-hold",
            "adjust-keyboard-to",
            "bindlinechange",
            "bindkeyboardheightchange",
            "placeholder-class",
            "fixed",
            "show-confirm-bar"
          ],
          "status": 2
        },
        {
          "name": "public-access-dialog",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        }
      ],
      "type": "templete"
    },
    "pages/add-node/add-node.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/announcement-admin/announcement-admin.js": {
      "status": 2,
      "components": [
        {
          "name": "has.pageScrollTo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-scroll#haspagescrollto",
          "status": 1
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/announcement-admin/announcement-admin.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/announcement-admin/announcement-admin.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "input",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-input",
          "attrs": [
            "type不支持以下的值：\r\n- idcard\r\n- digit\r\n- safe-password\r\n- nickname",
            "placeholder-style",
            "cursor-spacing",
            "auto-focus",
            "always-embed",
            "confirm-hold",
            "cursor",
            "cursor-color",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "safe-password-cert-path",
            "safe-password-length",
            "safe-password-time-stamp",
            "safe-password-nonce",
            "safe-password-salt",
            "safe-password-custom-hash",
            "bindchange",
            "bindkeyboardheightchange",
            "bindnicknamereview",
            "placeholder-class"
          ],
          "status": 2
        },
        {
          "name": "textarea",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-textarea",
          "attrs": [
            "auto-focus",
            "cursor-spacing",
            "cursor",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "disable-default-padding",
            "confirm-hold",
            "adjust-keyboard-to",
            "bindlinechange",
            "bindkeyboardheightchange",
            "placeholder-class",
            "fixed",
            "show-confirm-bar"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "pages/announcement-admin/announcement-admin.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/announcements/announcements.js": {
      "status": 1,
      "components": [
        {
          "name": "has.stopPullDownRefresh",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-pull-down-refresh#hasstoppulldownrefresh",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/announcements/announcements.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/announcements/announcements.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "pages/announcements/announcements.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/cost-meter/cost-meter.js": {
      "status": 2,
      "components": [
        {
          "name": "has.getWindowInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetwindowinfo",
          "status": 1
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.getMenuButtonBoundingClientRect",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-menu#hasgetmenubuttonboundingclientrect",
          "status": 1
        },
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        },
        {
          "name": "has.reLaunch",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasrelaunch",
          "status": 1
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.createSelectorQuery",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-hxml#hascreateselectorquery",
          "status": 1
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/cost-meter/cost-meter.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/cost-meter/cost-meter.hxml": {
      "status": 2,
      "components": [
        {
          "name": "import",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "dsh-switch",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        },
        {
          "name": "input",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-input",
          "attrs": [
            "type不支持以下的值：\r\n- idcard\r\n- digit\r\n- safe-password\r\n- nickname",
            "placeholder-style",
            "cursor-spacing",
            "auto-focus",
            "always-embed",
            "confirm-hold",
            "cursor",
            "cursor-color",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "safe-password-cert-path",
            "safe-password-length",
            "safe-password-time-stamp",
            "safe-password-nonce",
            "safe-password-salt",
            "safe-password-custom-hash",
            "bindchange",
            "bindkeyboardheightchange",
            "bindnicknamereview",
            "placeholder-class"
          ],
          "status": 2
        },
        {
          "name": "template",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "textarea",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-textarea",
          "attrs": [
            "auto-focus",
            "cursor-spacing",
            "cursor",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "disable-default-padding",
            "confirm-hold",
            "adjust-keyboard-to",
            "bindlinechange",
            "bindkeyboardheightchange",
            "placeholder-class",
            "fixed",
            "show-confirm-bar"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "pages/cost-meter/cost-meter.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/files/files.js": {
      "status": 2,
      "components": [
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/files/files.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/files/files.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        }
      ],
      "type": "templete"
    },
    "pages/files/files.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/home/home.js": {
      "status": 3,
      "components": [
        {
          "name": "has.getWindowInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetwindowinfo",
          "status": 1
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.getAppBaseInfo",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.getMenuButtonBoundingClientRect",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-menu#hasgetmenubuttonboundingclientrect",
          "status": 1
        },
        {
          "name": "has.onThemeChange",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.navigateTo",
          "attrs": [
            "入参缺少：events, routeType, routeConfig, routeOptions, withOpenContainer\r\nsuccess回调参数属性缺少：eventChannel"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateto",
          "status": 2
        },
        {
          "name": "has.getSystemSetting",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsystemsetting",
          "status": 1
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.showLoading",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowloading",
          "status": 1
        },
        {
          "name": "has.hideLoading",
          "attrs": [
            "入参属性缺少：noConflict"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hashideloading",
          "status": 2
        },
        {
          "name": "has.createSelectorQuery",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-hxml#hascreateselectorquery",
          "status": 1
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.scanCode",
          "attrs": [
            "success回调函数参数属性缺失：charSet;path;rawData",
            "success回调函数参数属性缺失：charSet;path;rawData"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-scan#hasscancode",
          "status": 2
        },
        {
          "name": "has.setNavigationBarColor",
          "attrs": [
            "入参属性缺少：animation"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-navigation#hassetnavigationbarcolor",
          "status": 2
        },
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/home/home.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/home/home.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "import",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "template",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "ocean-background",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        },
        {
          "name": "input",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-input",
          "attrs": [
            "type不支持以下的值：\r\n- idcard\r\n- digit\r\n- safe-password\r\n- nickname",
            "placeholder-style",
            "cursor-spacing",
            "auto-focus",
            "always-embed",
            "confirm-hold",
            "cursor",
            "cursor-color",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "safe-password-cert-path",
            "safe-password-length",
            "safe-password-time-stamp",
            "safe-password-nonce",
            "safe-password-salt",
            "safe-password-custom-hash",
            "bindchange",
            "bindkeyboardheightchange",
            "bindnicknamereview",
            "placeholder-class"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "textarea",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-textarea",
          "attrs": [
            "auto-focus",
            "cursor-spacing",
            "cursor",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "disable-default-padding",
            "confirm-hold",
            "adjust-keyboard-to",
            "bindlinechange",
            "bindkeyboardheightchange",
            "placeholder-class",
            "fixed",
            "show-confirm-bar"
          ],
          "status": 2
        },
        {
          "name": "public-access-dialog",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        }
      ],
      "type": "templete"
    },
    "pages/home/home.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/insights/insights.js": {
      "status": 2,
      "components": [
        {
          "name": "has.stopPullDownRefresh",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-pull-down-refresh#hasstoppulldownrefresh",
          "status": 1
        },
        {
          "name": "has.navigateTo",
          "attrs": [
            "入参缺少：events, routeType, routeConfig, routeOptions, withOpenContainer\r\nsuccess回调参数属性缺少：eventChannel"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateto",
          "status": 2
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.setClipboardData",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-clipboard#hassetclipboarddata",
          "status": 1
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/insights/insights.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/insights/insights.hxml": {
      "status": 2,
      "components": [
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "picker",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-picker",
          "attrs": [
            "header-text"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "input",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-input",
          "attrs": [
            "type不支持以下的值：\r\n- idcard\r\n- digit\r\n- safe-password\r\n- nickname",
            "placeholder-style",
            "cursor-spacing",
            "auto-focus",
            "always-embed",
            "confirm-hold",
            "cursor",
            "cursor-color",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "safe-password-cert-path",
            "safe-password-length",
            "safe-password-time-stamp",
            "safe-password-nonce",
            "safe-password-salt",
            "safe-password-custom-hash",
            "bindchange",
            "bindkeyboardheightchange",
            "bindnicknamereview",
            "placeholder-class"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "pages/insights/insights.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/pairing-admin/pairing-admin.js": {
      "status": 2,
      "components": [
        {
          "name": "has.setClipboardData",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-clipboard#hassetclipboarddata",
          "status": 1
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/pairing-admin/pairing-admin.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/pairing-admin/pairing-admin.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "picker",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-picker",
          "attrs": [
            "header-text"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "pages/pairing-admin/pairing-admin.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/plugin-detail/plugin-detail.js": {
      "status": 2,
      "components": [
        {
          "name": "has.getWindowInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetwindowinfo",
          "status": 1
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        },
        {
          "name": "has.reLaunch",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasrelaunch",
          "status": 1
        },
        {
          "name": "has.navigateTo",
          "attrs": [
            "入参缺少：events, routeType, routeConfig, routeOptions, withOpenContainer\r\nsuccess回调参数属性缺少：eventChannel"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateto",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/plugin-detail/plugin-detail.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/plugin-detail/plugin-detail.hxml": {
      "status": 2,
      "components": [
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "dsh-switch",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "include",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        }
      ],
      "type": "templete"
    },
    "pages/plugin-detail/plugin-detail.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/plugin-detail/settings-actions.js": {
      "status": 1,
      "components": [
        {
          "name": "has.setClipboardData",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-clipboard#hassetclipboarddata",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/plugin-detail/settings-form.hxml": {
      "status": 2,
      "components": [
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "dsh-switch",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "input",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-input",
          "attrs": [
            "type不支持以下的值：\r\n- idcard\r\n- digit\r\n- safe-password\r\n- nickname",
            "placeholder-style",
            "cursor-spacing",
            "auto-focus",
            "always-embed",
            "confirm-hold",
            "cursor",
            "cursor-color",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "safe-password-cert-path",
            "safe-password-length",
            "safe-password-time-stamp",
            "safe-password-nonce",
            "safe-password-salt",
            "safe-password-custom-hash",
            "bindchange",
            "bindkeyboardheightchange",
            "bindnicknamereview",
            "placeholder-class"
          ],
          "status": 2
        },
        {
          "name": "picker",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-picker",
          "attrs": [
            "header-text"
          ],
          "status": 2
        },
        {
          "name": "include",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        }
      ],
      "type": "templete"
    },
    "pages/plugin-detail/voice-settings.hxml": {
      "status": 2,
      "components": [
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "picker",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-picker",
          "attrs": [
            "header-text"
          ],
          "status": 2
        },
        {
          "name": "progress",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-progress",
          "attrs": [
            "@activeend"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "pages/plugins/install-actions.js": {
      "status": 2,
      "components": [
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        },
        {
          "name": "has.reLaunch",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasrelaunch",
          "status": 1
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/plugins/plugins.js": {
      "status": 3,
      "components": [
        {
          "name": "has.createOffscreenCanvas",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.getWindowInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetwindowinfo",
          "status": 1
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        },
        {
          "name": "has.reLaunch",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasrelaunch",
          "status": 1
        },
        {
          "name": "has.navigateTo",
          "attrs": [
            "入参缺少：events, routeType, routeConfig, routeOptions, withOpenContainer\r\nsuccess回调参数属性缺少：eventChannel"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateto",
          "status": 2
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/plugins/plugins.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/plugins/plugins.hxml": {
      "status": 2,
      "components": [
        {
          "name": "template",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "dsh-switch",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "input",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-input",
          "attrs": [
            "type不支持以下的值：\r\n- idcard\r\n- digit\r\n- safe-password\r\n- nickname",
            "placeholder-style",
            "cursor-spacing",
            "auto-focus",
            "always-embed",
            "confirm-hold",
            "cursor",
            "cursor-color",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "safe-password-cert-path",
            "safe-password-length",
            "safe-password-time-stamp",
            "safe-password-nonce",
            "safe-password-salt",
            "safe-password-custom-hash",
            "bindchange",
            "bindkeyboardheightchange",
            "bindnicknamereview",
            "placeholder-class"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "pages/plugins/plugins.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/privacy/privacy.js": {
      "status": 1,
      "components": [
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        },
        {
          "name": "has.redirectTo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasredirectto",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/privacy/privacy.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/privacy/privacy.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "privacy-sheet",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        }
      ],
      "type": "templete"
    },
    "pages/privacy/privacy.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/redeem-admin/redeem-admin.js": {
      "status": 2,
      "components": [
        {
          "name": "has.setClipboardData",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-clipboard#hassetclipboarddata",
          "status": 1
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/redeem-admin/redeem-admin.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/redeem-admin/redeem-admin.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "pages/redeem-admin/redeem-admin.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/schedule/schedule.js": {
      "status": 2,
      "components": [
        {
          "name": "has.getWindowInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetwindowinfo",
          "status": 1
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        },
        {
          "name": "has.reLaunch",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasrelaunch",
          "status": 1
        },
        {
          "name": "has.navigateTo",
          "attrs": [
            "入参缺少：events, routeType, routeConfig, routeOptions, withOpenContainer\r\nsuccess回调参数属性缺少：eventChannel"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateto",
          "status": 2
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/schedule/schedule.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/schedule/schedule.hxml": {
      "status": 2,
      "components": [
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        },
        {
          "name": "input",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-input",
          "attrs": [
            "type不支持以下的值：\r\n- idcard\r\n- digit\r\n- safe-password\r\n- nickname",
            "placeholder-style",
            "cursor-spacing",
            "auto-focus",
            "always-embed",
            "confirm-hold",
            "cursor",
            "cursor-color",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "safe-password-cert-path",
            "safe-password-length",
            "safe-password-time-stamp",
            "safe-password-nonce",
            "safe-password-salt",
            "safe-password-custom-hash",
            "bindchange",
            "bindkeyboardheightchange",
            "bindnicknamereview",
            "placeholder-class"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "textarea",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-textarea",
          "attrs": [
            "auto-focus",
            "cursor-spacing",
            "cursor",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "disable-default-padding",
            "confirm-hold",
            "adjust-keyboard-to",
            "bindlinechange",
            "bindkeyboardheightchange",
            "placeholder-class",
            "fixed",
            "show-confirm-bar"
          ],
          "status": 2
        },
        {
          "name": "picker",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-picker",
          "attrs": [
            "header-text"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "pages/schedule/schedule.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/session/file-actions.js": {
      "status": 3,
      "components": [
        {
          "name": "has.setClipboardData",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-clipboard#hassetclipboarddata",
          "status": 1
        },
        {
          "name": "has.shareFileMessage",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.previewImage",
          "attrs": [
            "入参属性缺失：referrerPolicy"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-image#haspreviewimage",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/session/image-blocks.js": {
      "status": 2,
      "components": [
        {
          "name": "has.previewImage",
          "attrs": [
            "入参属性缺失：referrerPolicy"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-image#haspreviewimage",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/session/session.js": {
      "status": 3,
      "components": [
        {
          "name": "has.getWindowInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetwindowinfo",
          "status": 1
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.getMenuButtonBoundingClientRect",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-menu#hasgetmenubuttonboundingclientrect",
          "status": 1
        },
        {
          "name": "has.nextTick",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-custom-components#hasnexttick",
          "status": 1
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        },
        {
          "name": "has.reLaunch",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasrelaunch",
          "status": 1
        },
        {
          "name": "has.hideKeyboard",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-keyboard#hashidekeyboard",
          "status": 1
        },
        {
          "name": "has.setClipboardData",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-clipboard#hassetclipboarddata",
          "status": 1
        },
        {
          "name": "has.createSelectorQuery",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-hxml#hascreateselectorquery",
          "status": 1
        },
        {
          "name": "has.navigateTo",
          "attrs": [
            "入参缺少：events, routeType, routeConfig, routeOptions, withOpenContainer\r\nsuccess回调参数属性缺少：eventChannel"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateto",
          "status": 2
        },
        {
          "name": "has.createOffscreenCanvas",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.canvasToTempFilePath",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-canvas#hascanvastotempfilepath",
          "status": 1
        },
        {
          "name": "has.getFileSystemManager",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-file#hasgetfilesystemmanager",
          "status": 1
        },
        {
          "name": "has.previewImage",
          "attrs": [
            "入参属性缺失：referrerPolicy"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-image#haspreviewimage",
          "status": 2
        },
        {
          "name": "has.chooseMessageFile",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.getFileInfo",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.compressImage",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.getImageInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-image#hasgetimageinfo",
          "status": 1
        },
        {
          "name": "has.chooseMedia",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-video#haschoosemedia",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/session/session.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/session/session.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "import",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "template",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "rich-text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-rich-text",
          "attrs": [
            "selectable",
            "image-menu-prevent",
            "preview",
            "@itemclick"
          ],
          "status": 2
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "input",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-input",
          "attrs": [
            "type不支持以下的值：\r\n- idcard\r\n- digit\r\n- safe-password\r\n- nickname",
            "placeholder-style",
            "cursor-spacing",
            "auto-focus",
            "always-embed",
            "confirm-hold",
            "cursor",
            "cursor-color",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "safe-password-cert-path",
            "safe-password-length",
            "safe-password-time-stamp",
            "safe-password-nonce",
            "safe-password-salt",
            "safe-password-custom-hash",
            "bindchange",
            "bindkeyboardheightchange",
            "bindnicknamereview",
            "placeholder-class"
          ],
          "status": 2
        },
        {
          "name": "canvas",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-canvas",
          "attrs": [],
          "status": 1
        },
        {
          "name": "textarea",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-textarea",
          "attrs": [
            "auto-focus",
            "cursor-spacing",
            "cursor",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "disable-default-padding",
            "confirm-hold",
            "adjust-keyboard-to",
            "bindlinechange",
            "bindkeyboardheightchange",
            "placeholder-class",
            "fixed",
            "show-confirm-bar"
          ],
          "status": 2
        },
        {
          "name": "voice-overlay",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "public-access-dialog",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        }
      ],
      "type": "templete"
    },
    "pages/session/session.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/session/utils/context-panels-pref.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/session/utils/context-prefs.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/session/utils/notify-pref.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/session/utils/notify-subscription.js": {
      "status": 2,
      "components": [
        {
          "name": "has.requestSubscribeMessage",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-message-subscription#hasrequestsubscribemessage",
          "status": 1
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/session/utils/proc-icon-style.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/session/utils/status-appearance.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/session/utils/voice-preference.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/session/utils/work-step-presentation.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/session/viewport-actions.js": {
      "status": 1,
      "components": [
        {
          "name": "has.createSelectorQuery",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-hxml#hascreateselectorquery",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/session/voice-actions.js": {
      "status": 2,
      "components": [
        {
          "name": "has.hideKeyboard",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-keyboard#hashidekeyboard",
          "status": 1
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.openSetting",
          "attrs": [
            "入参属性缺失：withSubscriptions; \r\nsuccess回调函数参数属性缺失：subscriptionsSetting",
            "入参属性缺失：withSubscriptions; \r\nsuccess回调函数参数属性缺失：subscriptionsSetting"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-setting#hasopensetting",
          "status": 2
        },
        {
          "name": "has.navigateTo",
          "attrs": [
            "入参缺少：events, routeType, routeConfig, routeOptions, withOpenContainer\r\nsuccess回调参数属性缺少：eventChannel"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateto",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/session-settings/native-picker.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/session-settings/session-settings.js": {
      "status": 3,
      "components": [
        {
          "name": "has.null",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.getWindowInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetwindowinfo",
          "status": 1
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.getMenuButtonBoundingClientRect",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-menu#hasgetmenubuttonboundingclientrect",
          "status": 1
        },
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        },
        {
          "name": "has.reLaunch",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasrelaunch",
          "status": 1
        },
        {
          "name": "has.openUrl",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.setClipboardData",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-clipboard#hassetclipboarddata",
          "status": 1
        },
        {
          "name": "has.createSelectorQuery",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-hxml#hascreateselectorquery",
          "status": 1
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.navigateTo",
          "attrs": [
            "入参缺少：events, routeType, routeConfig, routeOptions, withOpenContainer\r\nsuccess回调参数属性缺少：eventChannel"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateto",
          "status": 2
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.getStorageInfoSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstorageinfosync",
          "status": 1
        },
        {
          "name": "has.removeStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasremovestoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/session-settings/session-settings.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/session-settings/session-settings.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        },
        {
          "name": "template",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "pages/session-settings/session-settings.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/session-settings/utils/account-card-pref.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/settings/settings.js": {
      "status": 3,
      "components": [
        {
          "name": "has.null",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.getWindowInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetwindowinfo",
          "status": 1
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.getMenuButtonBoundingClientRect",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-menu#hasgetmenubuttonboundingclientrect",
          "status": 1
        },
        {
          "name": "has.createSelectorQuery",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-hxml#hascreateselectorquery",
          "status": 1
        },
        {
          "name": "has.openUrl",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.setClipboardData",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-clipboard#hassetclipboarddata",
          "status": 1
        },
        {
          "name": "has.getFileSystemManager",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-file#hasgetfilesystemmanager",
          "status": 1
        },
        {
          "name": "has.env",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasenv",
          "status": 1
        },
        {
          "name": "has.navigateTo",
          "attrs": [
            "入参缺少：events, routeType, routeConfig, routeOptions, withOpenContainer\r\nsuccess回调参数属性缺少：eventChannel"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateto",
          "status": 2
        },
        {
          "name": "has.showLoading",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowloading",
          "status": 1
        },
        {
          "name": "has.hideLoading",
          "attrs": [
            "入参属性缺少：noConflict"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hashideloading",
          "status": 2
        },
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        },
        {
          "name": "has.reLaunch",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasrelaunch",
          "status": 1
        },
        {
          "name": "has.showShareMenu",
          "attrs": [
            "入参属性缺失：withShareTicket; menus",
            "入参属性缺失：withShareTicket; menus"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-share#hasshowsharemenu",
          "status": 2
        },
        {
          "name": "has.hideShareMenu",
          "attrs": [
            "入参属性缺失：menus",
            "入参属性缺失：menus"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-share#hashidesharemenu",
          "status": 2
        },
        {
          "name": "has.showActionSheet",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowactionsheet",
          "status": 1
        },
        {
          "name": "has.scanCode",
          "attrs": [
            "success回调函数参数属性缺失：charSet;path;rawData",
            "success回调函数参数属性缺失：charSet;path;rawData"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-scan#hasscancode",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/settings/settings.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/settings/settings.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "import",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "dsh-switch",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "template",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        },
        {
          "name": "input",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-input",
          "attrs": [
            "type不支持以下的值：\r\n- idcard\r\n- digit\r\n- safe-password\r\n- nickname",
            "placeholder-style",
            "cursor-spacing",
            "auto-focus",
            "always-embed",
            "confirm-hold",
            "cursor",
            "cursor-color",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "safe-password-cert-path",
            "safe-password-length",
            "safe-password-time-stamp",
            "safe-password-nonce",
            "safe-password-salt",
            "safe-password-custom-hash",
            "bindchange",
            "bindkeyboardheightchange",
            "bindnicknamereview",
            "placeholder-class"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "privacy-sheet",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "textarea",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-textarea",
          "attrs": [
            "auto-focus",
            "cursor-spacing",
            "cursor",
            "selection-start",
            "selection-end",
            "adjust-position",
            "hold-keyboard",
            "disable-default-padding",
            "confirm-hold",
            "adjust-keyboard-to",
            "bindlinechange",
            "bindkeyboardheightchange",
            "placeholder-class",
            "fixed",
            "show-confirm-bar"
          ],
          "status": 2
        },
        {
          "name": "canvas",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-canvas",
          "attrs": [],
          "status": 1
        },
        {
          "name": "public-access-dialog",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "slider",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-slider",
          "attrs": [
            "color",
            "selected-color"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "pages/settings/settings.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/settings/utils/account-card-pref.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/settings/utils/context-panels-pref.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/settings/utils/context-prefs.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/settings/utils/notify-pref.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/settings/utils/proc-icon-style.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/settings/utils/status-appearance.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/settings/utils/storage-usage.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/settings/utils/voice-preference.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/settings/utils/work-step-presentation.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/share-activity/share-activity.js": {
      "status": 2,
      "components": [
        {
          "name": "has.showShareMenu",
          "attrs": [
            "入参属性缺失：withShareTicket; menus",
            "入参属性缺失：withShareTicket; menus"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-share#hasshowsharemenu",
          "status": 2
        },
        {
          "name": "has.hideShareMenu",
          "attrs": [
            "入参属性缺失：menus",
            "入参属性缺失：menus"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-share#hashidesharemenu",
          "status": 2
        },
        {
          "name": "has.reLaunch",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasrelaunch",
          "status": 1
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.chooseMedia",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-video#haschoosemedia",
          "status": 1
        },
        {
          "name": "has.getFileSystemManager",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-file#hasgetfilesystemmanager",
          "status": 1
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "pages/share-activity/share-activity.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/share-activity/share-activity.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "button",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-button",
          "attrs": [
            "form-type不支持以下的值：\r\n- submitToGroup",
            "open-type不支持以下的值：\r\n- contact\r\n- liveActivity\r\n- share\r\n- getRealtimePhoneNumber\r\n- getUserInfo\r\n- feedback\r\n- chooseAvatar\r\n- agreePrivacyAuthorization",
            "lang",
            "session-from",
            "send-message-title",
            "send-message-path",
            "send-message-img",
            "show-message-card",
            "phone-number-no-quota-toast",
            "need-show-entrance",
            "entrance-path",
            "bindgetuserinfo",
            "bindcontact",
            "createliveactivity",
            "bindgetrealtimephonenumber",
            "bindchooseavatar",
            "bindagreeprivacyauthorization"
          ],
          "status": 2
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "pages/share-activity/share-activity.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "pages/workspace-picker/workspace-picker.js": {
      "status": 2,
      "components": [
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.showToast",
          "attrs": [
            "入参属性缺少：icon, image, mask"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowtoast",
          "status": 2
        },
        {
          "name": "has.navigateBack",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateback",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "pages/workspace-picker/workspace-picker.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "pages/workspace-picker/workspace-picker.hxml": {
      "status": 3,
      "components": [
        {
          "name": "page-meta",
          "attrs": [
            "此组件在ASCF框架中不支持，请手动检查"
          ],
          "status": 3
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        },
        {
          "name": "image",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-image",
          "attrs": [
            "show-menu-by-longpress",
            "webp",
            "lazy-load"
          ],
          "status": 2
        },
        {
          "name": "scroll-view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-scroll-view",
          "attrs": [
            "enable-back-to-top",
            "binddragstart",
            "binddragging",
            "binddragend",
            "scroll-anchoring",
            "enable-flex",
            "@scrolltoupper",
            "@scrolltolower",
            "@scroll",
            "@refresherpulling",
            "@refresherrefresh",
            "@refresherrestore",
            "@refresherabort"
          ],
          "status": 2
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        }
      ],
      "type": "templete"
    },
    "pages/workspace-picker/workspace-picker.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "project.config.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "sitemap.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "styles/glass-ui.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "styles/proc-icon.hxml": {
      "status": 1,
      "components": [
        {
          "name": "template",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        }
      ],
      "type": "templete"
    },
    "styles/proc-icon.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "styles/quota-sidebar.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "styles/status-appearance.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "styles/status-tail-animation.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "styles/trajectory.css": {
      "status": 1,
      "components": [],
      "type": "wxssModular"
    },
    "templates/quota-sidebar.hxml": {
      "status": 2,
      "components": [
        {
          "name": "template",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "view",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-view",
          "attrs": [],
          "status": 1
        },
        {
          "name": "block",
          "attrs": [
            "自定义组件"
          ],
          "doc": "自定义组件",
          "status": 1
        },
        {
          "name": "text",
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/components-text",
          "attrs": [
            "selectable"
          ],
          "status": 2
        }
      ],
      "type": "templete"
    },
    "theme.json": {
      "status": 1,
      "components": [],
      "type": "jsonModular"
    },
    "utils/access-api.js": {
      "status": 2,
      "components": [
        {
          "name": "has.removeStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasremovestoragesync",
          "status": 1
        },
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.request",
          "attrs": [
            "入参属性缺失：useHighPerformanceMode, enableQuic, enableHttpDNS, httpDNSServiceId, httpDNSTimeout, enableChunked, forceCellularNetwork, redirect\r\nsuccess回调参数属性确实：exception, useHttpDNS"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-request#hasrequest",
          "status": 2
        },
        {
          "name": "has.login",
          "attrs": [
            "缺少参数字段: timeout",
            "缺少参数字段: timeout"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-account#haslogin",
          "status": 2
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "utils/crypto.js": {
      "status": 3,
      "components": [
        {
          "name": "has.getPerformance",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.getRandomValues",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-crypto#hasgetrandomvalues",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "utils/gateway.js": {
      "status": 2,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        },
        {
          "name": "has.getDeviceInfo",
          "attrs": [
            "返回值缺少：abi, deviceAbi, benchmarkLevel, cpuType,"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetdeviceinfo",
          "status": 2
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.connectSocket",
          "attrs": [
            "入参属性缺失：tcpNoDelay, perMessageDeflate, timeout, forceCellularNetwork"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-websocket#hasconnectsocket",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "utils/haptics.js": {
      "status": 2,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        },
        {
          "name": "has.vibrateLong",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-vibrator#hasvibratelong",
          "status": 1
        },
        {
          "name": "has.vibrateShort",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-vibrator#hasvibrateshort",
          "status": 1
        },
        {
          "name": "has.getDeviceInfo",
          "attrs": [
            "返回值缺少：abi, deviceAbi, benchmarkLevel, cpuType,"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetdeviceinfo",
          "status": 2
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "utils/home-animation-pref.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "utils/hosts.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        },
        {
          "name": "has.removeStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasremovestoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "utils/plugin-install.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "utils/public-access-prompt.js": {
      "status": 3,
      "components": [
        {
          "name": "has.getCurrentPages",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.navigateTo",
          "attrs": [
            "入参缺少：events, routeType, routeConfig, routeOptions, withOpenContainer\r\nsuccess回调参数属性缺少：eventChannel"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasnavigateto",
          "status": 2
        },
        {
          "name": "has.redirectTo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasredirectto",
          "status": 1
        },
        {
          "name": "has.switchTab",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-router#hasswitchtab",
          "status": 1
        },
        {
          "name": "has.showModal",
          "attrs": [
            "入参属性缺少：editable, placeholderText"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-interaction#hasshowmodal",
          "status": 2
        },
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "utils/quota-sidebar-glass-pref.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "utils/runtime.js": {
      "status": 3,
      "components": [
        {
          "name": "has.getAccountInfoSync",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        }
      ],
      "type": "jsModular"
    },
    "utils/session-glass-pref.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "utils/settings-glass-pref.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "utils/settings-glass-sheet-pref.js": {
      "status": 1,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        }
      ],
      "type": "jsModular"
    },
    "utils/settings-glass-style-pref.js": {
      "status": 2,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        },
        {
          "name": "has.getWindowInfo",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetwindowinfo",
          "status": 1
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "utils/share.js": {
      "status": 2,
      "components": [
        {
          "name": "has.showShareMenu",
          "attrs": [
            "入参属性缺失：withShareTicket; menus",
            "入参属性缺失：withShareTicket; menus"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-share#hasshowsharemenu",
          "status": 2
        },
        {
          "name": "has.hideShareMenu",
          "attrs": [
            "入参属性缺失：menus",
            "入参属性缺失：menus"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-share#hashidesharemenu",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "utils/store.js": {
      "status": 2,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        },
        {
          "name": "has.removeStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasremovestoragesync",
          "status": 1
        },
        {
          "name": "has.onNetworkStatusChange",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-network-type#hasonnetworkstatuschange",
          "status": 1
        },
        {
          "name": "has.getNetworkType",
          "attrs": [
            "success回调函数参数属性缺失：signalStrength;hasSystemProxy;weakNet",
            "success回调函数参数属性缺失：signalStrength;hasSystemProxy;weakNet"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-network-type#hasgetnetworktype",
          "status": 2
        }
      ],
      "type": "jsModular"
    },
    "utils/theme.js": {
      "status": 3,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        },
        {
          "name": "has.removeStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasremovestoragesync",
          "status": 1
        },
        {
          "name": "has.getAppBaseInfo",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.onThemeChange",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.setNavigationBarColor",
          "attrs": [
            "入参属性缺少：animation"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-navigation#hassetnavigationbarcolor",
          "status": 2
        },
        {
          "name": "has.setBackgroundColor",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        }
      ],
      "type": "jsModular"
    },
    "utils/ui-preferences.js": {
      "status": 3,
      "components": [
        {
          "name": "has.getStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hasgetstoragesync",
          "status": 1
        },
        {
          "name": "has.getAppBaseInfo",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.getSystemInfoSync",
          "attrs": [
            "返回值缺少：pixelRatio, version, benchmarkLevel, albumAuthorized, cameraAuthorized, locationAuthorized, microphoneAuthorized, notificationAuthorized, notificationAlertAuthorized, notificationBadgeAuthorized, notificationSoundAuthorized, phoneCalendarAuthorized, host, flocationReducedAccuracy, enableDebug",
            "返回值新增：OSApiVersion, indicatorHeight"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-system-info#hasgetsysteminfosync",
          "status": 2
        },
        {
          "name": "has.name",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.null",
          "attrs": [
            "此API在ASCF框架中不支持，请先参考链接屏蔽，后续手动检查并实现等效功能"
          ],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/faqs-others-running-abnormally",
          "status": 3
        },
        {
          "name": "has.setStorageSync",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-data-storage#hassetstoragesync",
          "status": 1
        },
        {
          "name": "has.setNavigationBarTitle",
          "attrs": [],
          "doc": "https://developer.huawei.com/consumer/cn/doc/atomic-ascf/apis-navigation#hassetnavigationbartitle",
          "status": 1
        }
      ],
      "type": "jsModular"
    }
  },
  "configs": {},
  "plugins": [],
  "surroundings": {
    "pcSystem": {
      "name": "系统环境",
      "val": "darwin"
    },
    "nodeVersion": {
      "name": "Node.js版本",
      "val": "v22.22.3"
    },
    "version": {
      "name": "ASCF",
      "val": "1.0.17"
    }
  },
  "tableInfo": {
    "文件总数": 151,
    "源项目路径": "miniprogram",
    "目标输出路径": "harmonyos/atomic-service/ascf/ascf_src",
    "转换耗时": "3.646s"
  },
  "opening": {},
  "concept": {
    "modelAll": 151,
    "completely": 90,
    "partial": 34,
    "notsupport": 27
  }
}