# 方坤原生健康读取模块

## 当前交付状态

本目录提供真实的 Capacitor 插件源码：iOS 调用 HealthKit，Android 调用 AndroidX Health Connect。前端入口为 `src/lib/health/native-health.ts`，复用现有“设备连接与同步”窗口。插件没有网页模拟实现，没有向 `window` 注入假健康数据，也没有在安装 PWA 后冒充原生健康权限。

**本次已完成前端适配、纯数据边界测试和 SDK 接口核对。未在本环境编译或运行原生安装包，未取得任何真实健康权限，也未用真实设备数据验收。** 当前工程原先只有 TanStack/React Web/PWA，尚无签名的 iOS/Android 宿主。仅安装这个 npm 包不会产生手机 App。

原生工程接入、平台签名/权限声明和真机验收仍是使手机端可用的必要步骤；不得把本目录的存在写成“Apple 健康/Health Connect 已接通”。

## 对统一窗口的契约

```ts
type NativeHealthProvider = 'apple_health' | 'health_connect'

getNativeHealthStatus(provider): Promise<{
  available: boolean
  state: 'available' | 'needs_native_app' | 'provider_unavailable' | 'permissions_required'
  message: string
}>

requestNativeHealthPermissions(provider): Promise<上述状态>
readNativeHealth(provider, { from: 带时区ISO时间, to: 带时区ISO时间 }): Promise<DeviceParseResult>
```

- 普通网页/PWA返回 `needs_native_app`。系统不匹配、Health Connect缺失/需更新或SDK不可用返回 `provider_unavailable`。
- `permissions_required.available=true` 表示已安装的系统健康服务可以请求权限；它不代表已经能读取。窗口按 `state` 判断动作。
- `available` 仅表示可尝试读取。尤其在iOS，HealthKit不会告诉应用用户是否拒绝了某一项读取；“系统授权流程完成”和“有可读取数据”是不同的事实。空列表可能是没有记录、未开放读取、有限历史范围等情况，不能标成已授权或已同步成功。
- 业务界面保持一个窗口。操作系统必须展示的权限sheet/Activity属于系统授权流程。
- `readNativeHealth`不写数据库、不上传数据、不调用付费模型。窗口必须在请求开始时捕获当前运动员，异步返回及保存前再次比对；用户核对勾选后才调用现有 `src/lib/ui/device-store.ts` 的 `saveDeviceRows`。
- 每次原始读取范围最多31天。日指标按与所选范围相交的完整历日读取，今天截至读取时刻。Android日指标保守限制最近30个历日，不申请额外历史权限。原始训练与心率样本仍按请求时间范围读取。

## 原生插件接口

Capacitor注册名为 `FangkunHealth`，三个方法是：

```ts
checkAvailability({ provider })
requestReadPermissions({ provider })
readRecords({ provider, from, to })
```

前端必须同时通过 `Capacitor.isNativePlatform()`、平台匹配以及 `Capacitor.isPluginAvailable('FangkunHealth')` 检查。插件不提供Web fallback。不要在生产代码设置任何自定义全局对象绕过这些检查。

读取结果采用 `schemaVersion: 1`：

```ts
{
  schemaVersion: 1,
  provider: 'apple_health' | 'health_connect',
  readAt: string,              // 本次读取结束时间，绝不是测量时间
  workouts: NativeWorkout[],
  health: NativeHealthSample[],
  notes: string[],
  truncated: boolean,
  incompleteTypes: string[]    // SLEEP_STAGE不完整时不生成可保存日总量
}
```

`NativeWorkout`包含SDK原始记录ID、原始应用来源、开始结束时间、实际取得的时长/距离/活动能量及明确的运动类型。`NativeHealthSample`包含原始ID、原始来源、时间、记录归属日、明确指标类型、单位和值或睡眠分期。完整字段由同目录Swift/Kotlin实现以及前端归一化器定义，不以名称/标题猜原始厂商或用户账号。

## 数据映射与保留规则

| 数据 | iOS | Android | 保存边界 |
| --- | --- | --- | --- |
| 训练 | `HKWorkout`、原始UUID | `ExerciseSessionRecord`、`metadata.id` | 明确跑步/力量类型才分类，其余保持未知；不制造组数或训练分段 |
| 时长 | `HKWorkout.duration`原始Double秒数 | 原始起止`Instant`之差，保留小数秒 | 不舍入为整秒；Android标明是经过时长，可能含暂停 |
| 距离/活动能量 | Workout自带的可用总量 | 仅对同一`DataOrigin`及训练区间聚合已获准的Distance/ActiveCalories | 读不到是`null`；不借其他来源补齐 |
| 静息心率 | `restingHeartRate` | `RestingHeartRateRecord` | 保留独立样本，单位bpm；不暗中计算日均 |
| HRV | `heartRateVariabilitySDNN` | `HeartRateVariabilityRmssdRecord` | 分别标为SDNN/RMSSD，单位ms，不混算算法 |
| 睡眠 | `sleepAnalysis`分期 | `SleepSessionRecord.stages` | 只累计明确睡着的分段；同来源同归属日重叠区间算一次，不跨来源相加 |
| 步数 | HealthKit统计查询，按来源分别累计 | Health Connect聚合API的系统去重结果 | 未知不等于0；显式0保留；不把多来源原始记录简单求和 |
| 准备度/恢复分/身体电量/力量负重组数 | 不推算 | 不推算 | 缺失保留缺失 |

睡眠口径保持可追溯：iOS按各原始分期的结束日期归属，Android按原始睡眠会话结束日归属；缺原始时区时使用手机当前时区。iOS并没有在这里推断“哪几个分期构成同一晚”，所以结果可能与Apple健康的夜间展示口径不同。没有分期的Android睡眠会话不会把整个卧床时段猜成睡眠时长。

睡眠及步数读取完整的所选历日，避免“首日从上午开始的局部结果”覆盖既有完整日值。睡眠查询会为跨午夜及原记录时区保留查询边界余量，但只返回结束归属日在所选日期内的样本。达到分页/样本上限时显式标记不完整；睡眠不完整则不生成可覆盖已有值的日总量。同标识睡眠分段内容冲突时，排除受影响日的总量。

活动来源标识为 `apple_health:<原始来源>:<SDK记录ID>` 或 `health_connect:<原始来源>:<SDK记录ID>`。来源ID和记录ID使用URL编码保持分隔明确，绝不凭相近时间/距离合并跨平台训练。`provenance.provider`分别为`APPLE_HEALTH`和`HEALTH_CONNECT`，本模块不知道云账号，`accountRef=null`。健康Observation保留来源、统计口径、测量时间、读取时间和原始值/单位。归一化不改写0.1秒原始时长。

## 原生宿主接入步骤

### 共同前提

1. 使用相同的Capacitor稳定版：本轮核对为 `8.5.3`。宿主的 `@capacitor/core`、`@capacitor/ios`、`@capacitor/android` 和CLI保持相同版本。
2. 将本地模块作为宿主依赖：`"@fangkun/native-health": "file:native/fangkun-health"`，路径根据实际宿主位置调整。
3. 在原生宿主执行Capacitor同步，让CLI发现插件的`capacitor.ios/android`描述、Swift Package和Android模块。
4. 保留当前统一窗口及前端适配器的来源/权限/确认保存流程。

**当前Web构建依赖TanStack服务端。不能未经验证就把`.output/public`当成独立移动端静态入口。** 建立原生宿主时，需要为移动端产出可独立启动的本地客户端构建，并明确其服务端API配置与身份机制。此插件目录不替宿主完成这项架构工作，也不通过任意远程网页桥接取得健康权限。生产版不应让不受信的远程页面获得原生插件访问能力。

### iOS

本包采用Capacitor 8默认的Swift Package Manager路径，`Package.swift`位于包根目录，最低iOS15。睡眠细分阶段在iOS16以上通过可用性检查读取。

- 在签名的宿主Target启用HealthKit capability，并合并 `ios/FangkunHealth.entitlements` 的HealthKit entitlement。
- 将 `ios/HostInfo.plist.fragment` 中的 `NSHealthShareUsageDescription` 合并到宿主Info.plist。插件文件本身不能替宿主自动启用权限。
- 保持只读：`toShare`为空，不申请后台delivery，也不需要给用户新增写健康库授权。
- 构建后确认本包已由Capacitor注册为 `FangkunHealth`，在真机中点击统一窗口授权。系统sheet必须在主线程启动。

### Android

本包使用官方稳定 `androidx.health.connect:connect-client:1.1.0`；当前原生配置为compile/target SDK36、AGP8.13.0、Kotlin2.2.20、Java21，与Capacitor8构建工具链对齐。宿主需提供与该工具链匹配的Gradle及Android SDK（Capacitor8迁移文档使用Gradle8.14.3）。

- 实际Health Connect可用性由 `HealthConnectClient.getSdkStatus()`决定。Android14及以上是系统模块，13及以下需要Health Connect App；官方要求API28以上且Google Play服务可用。无GMS设备不能承诺可用。
- Manifest只声明7项读取权限：训练、静息心率、HRV、睡眠、步数、距离、活动能量。没有写入、后台或历史读取权限。
- Manifest包含权限说明Activity与Android14+权限说明alias。发行版应让这个说明页和Play Console提交的完整隐私政策一致，并完成对应Health Connect权限声明。
- 通过SDK的权限ActivityResultContract打开系统授权页，回调后重新读取实际授权集合；每次读取再次检查，支持部分授权与撤回。
- 记录读取遍历`pageToken`，有明确数量和时间上限；超时、拒绝、取消及Activity返回都会结束对应Promise。

## 必须完成的真机验收

本环境没有Xcode/Swift、Gradle/Android SDK或设备连接，以下项目尚未完成，不能记为通过：

- iOS/Android原生编译、签名、安装及冷启动。
- Apple拒绝全部/部分授权、重新授权、空健康库、有限历史权限下的真实结果。
- Android不可用/需更新、全部/部分授权、授权撤回、SDK分页及不同系统版本行为。
- 含小数秒的真实训练、真实睡眠分期/跨午夜/时区、同日多来源和今日部分进度。
- 统一窗口打开系统sheet后返回同一业务视图；取消不保存；异步期间切换运动员不把旧结果保存到新运动员。
- 重读相同原始ID不重复，来源不同不自动合并，原记录修订不覆盖既有手工更正。

前端纯数据与网页边界测试位于 `src/lib/health/native-health.test.ts`，其合成数据是测试夹具，不表示真机读取已通过。

## 本轮核对的官方资料

- [HealthKit授权和读取隐私](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
- [HealthKit设置](https://developer.apple.com/documentation/healthkit/setting-up-healthkit)
- [Health Connect开始接入](https://developer.android.com/health-and-fitness/health-connect/get-started)
- [Health Connect稳定版本](https://developer.android.com/jetpack/androidx/releases/health-connect)
- [Health Connect可用性](https://developer.android.com/health-and-fitness/health-connect/availability)
- [Health Connect读取和分页](https://developer.android.com/health-and-fitness/health-connect/read-data)
- [Health Connect睡眠](https://developer.android.com/health-and-fitness/health-connect/features/sleep-sessions)
- [Google Maven的1.1.0官方源码归档](https://dl.google.com/dl/android/maven2/androidx/health/connect/connect-client/1.1.0/connect-client-1.1.0-sources.jar)
- [Capacitor官方发布](https://github.com/ionic-team/capacitor/releases)
- [Capacitor iOS插件](https://capacitorjs.com/docs/plugins/ios)
- [Capacitor Android插件及Activity回调](https://capacitorjs.com/docs/plugins/android)
- [Capacitor 8工具链](https://capacitorjs.com/docs/updating/8-0)

核对日期：2026-10-22。
