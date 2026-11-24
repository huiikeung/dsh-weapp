/**
 * 协议文档的元信息：应用名、开发者、生效/更新日期与版本号。
 *
 * 「用户协议」「隐私政策」两个二级页和「首次启动隐私同意」都从这里取值。
 * 改日期或版本只动这个文件 —— 同意弹窗会据此判断是否需要让用户重新确认
 * （见 services/PrivacyConsent）。
 */
export const APP_DISPLAY_NAME: string = 'flukit';

/** 开发者 / 运营者（与用户协议文末「联系我们」一致）。如需改为法定姓名或公司主体，只改这一处。 */
export const DEVELOPER_NAME: string = '袁辉强';

/** 用户协议：生效日期与版本 */
export const USER_AGREEMENT_EFFECTIVE_AT: string = '2026年11月23日';
export const USER_AGREEMENT_VERSION: string = 'v1.0';

/** 隐私政策：更新日期 */
export const PRIVACY_POLICY_UPDATED_AT: string = '2026年11月23日';
