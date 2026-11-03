import { appTasks } from '@ohos/hvigor-ohos-plugin';
import ascfPlugin, { signByBuildModePlugin } from '@atomicservice/ascf-toolkit-hvigor-plugin';

export default {
  system: appTasks,  /* Built-in plugin of Hvigor. It cannot be modified. */
  plugins:[
    // disableSubpackages=false 必须显式传：ascf 编译默认（undefined）会把
    // build-profile.json5 里 16 个 pages_* 子包模块删掉，DevEco 再打开就报
    // 「目标不能为空」。设为 false 后每次构建都会保留子包模块，DevEco 也能直接 Run。
    ascfPlugin({ disableSubpackages: false }),
    signByBuildModePlugin('default', 'release')      // need build-profile.json5 配置 signingConfigs 调试和发布的签名
  ]
}
