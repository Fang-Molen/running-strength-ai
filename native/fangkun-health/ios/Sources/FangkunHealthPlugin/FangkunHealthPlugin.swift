import Foundation
import HealthKit
import Capacitor

@objc(FangkunHealthPlugin)
public class FangkunHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FangkunHealthPlugin"
    public let jsName = "FangkunHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkAvailability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestReadPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readRecords", returnType: CAPPluginReturnPromise)
    ]

    private let store = HKHealthStore()
    private var permissionInFlight = false // Only accessed on the main queue.
    private let sampleLimit = 5_000
    private let provider = "apple_health"

    private var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [HKObjectType.workoutType()]
        for identifier in [HKQuantityTypeIdentifier.restingHeartRate, .heartRateVariabilitySDNN, .stepCount] {
            if let type = HKObjectType.quantityType(forIdentifier: identifier) { types.insert(type) }
        }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
        return types
    }

    private func accepts(_ call: CAPPluginCall) -> Bool {
        guard call.getString("provider") == provider else {
            call.reject("HealthKit只能处理apple_health来源。", "PROVIDER_MISMATCH")
            return false
        }
        return true
    }

    private func status(_ call: CAPPluginCall, _ state: String, _ message: String) {
        call.resolve(["provider": provider, "state": state, "message": message])
    }

    @objc public func checkAvailability(_ call: CAPPluginCall) {
        guard accepts(call) else { return }
        guard HKHealthStore.isHealthDataAvailable() else {
            status(call, "provider_unavailable", "此设备不能使用Apple健康读取。")
            return
        }
        store.getRequestStatusForAuthorization(toShare: [], read: readTypes) { requestStatus, error in
            if error != nil {
                call.reject("无法检查HealthKit授权请求状态。", "HEALTHKIT_STATUS_FAILED")
                return
            }
            // This API reports whether another authorization request is needed, NOT read grants.
            if requestStatus == .unnecessary {
                self.status(call, "available", "可以尝试读取已开放的项目；HealthKit不公开读取权限是否获准。")
            } else {
                self.status(call, "permissions_required", "请在系统授权页选择允许方坤读取的项目。")
            }
        }
    }

    @objc public func requestReadPermissions(_ call: CAPPluginCall) {
        guard accepts(call) else { return }
        guard HKHealthStore.isHealthDataAvailable() else {
            status(call, "provider_unavailable", "此设备不能使用Apple健康读取。")
            return
        }
        DispatchQueue.main.async {
            guard !self.permissionInFlight else {
                call.reject("已有健康授权页面正在处理。", "PERMISSION_BUSY")
                return
            }
            self.permissionInFlight = true
            self.store.requestAuthorization(toShare: [], read: self.readTypes) { completed, error in
                DispatchQueue.main.async {
                    self.permissionInFlight = false
                    if error != nil {
                        call.reject("HealthKit授权流程未完成。", "HEALTHKIT_PERMISSION_FAILED")
                    } else if completed {
                        self.status(call, "available", "系统授权流程已完成，可尝试读取；这不表示所有读取权限均已获准。")
                    } else {
                        self.status(call, "permissions_required", "授权流程未完成，可在准备好后再次请求。")
                    }
                }
            }
        }
    }

    private static func parseDate(_ text: String?) -> Date? {
        guard let text else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: text)
    }

    private static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func day(_ date: Date, zone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func zone(_ sample: HKSample) -> TimeZone {
        if let name = sample.metadata?[HKMetadataKeyTimeZone] as? String, let zone = TimeZone(identifier: name) { return zone }
        return .current
    }

    private static func source(_ sample: HKSample) -> [String: Any] {
        ["id": sample.uuid.uuidString,
         "originId": sample.sourceRevision.source.bundleIdentifier,
         "originName": sample.sourceRevision.source.name,
         "startAt": iso(sample.startDate), "endAt": iso(sample.endDate)]
    }

    private static func sport(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "running"
        case .traditionalStrengthTraining, .functionalStrengthTraining: return "strength"
        case .walking, .hiking: return "walking"
        case .cycling: return "cycling"
        case .swimming: return "swimming"
        default: return "unknown"
        }
    }

    private static func sleepStage(_ value: Int) -> String {
        if value == HKCategoryValueSleepAnalysis.inBed.rawValue { return "in_bed" }
        if value == HKCategoryValueSleepAnalysis.awake.rawValue { return "awake" }
        if #available(iOS 16.0, *) {
            switch value {
            case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue: return "asleep"
            case HKCategoryValueSleepAnalysis.asleepCore.rawValue: return "light"
            case HKCategoryValueSleepAnalysis.asleepDeep.rawValue: return "deep"
            case HKCategoryValueSleepAnalysis.asleepREM.rawValue: return "rem"
            default: return "unknown"
            }
        }
        return value == HKCategoryValueSleepAnalysis.asleep.rawValue ? "asleep" : "unknown"
    }

    @objc public func readRecords(_ call: CAPPluginCall) {
        guard accepts(call) else { return }
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("此设备不能使用Apple健康读取。", "HEALTHKIT_UNAVAILABLE")
            return
        }
        guard let from = Self.parseDate(call.getString("from")), let to = Self.parseDate(call.getString("to")),
              from < to, to.timeIntervalSince(from) <= 31 * 86_400 else {
            call.reject("读取范围须为有效起止时间且不超过31天。", "INVALID_RANGE")
            return
        }
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to, options: [.strictStartDate])
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let dailyFrom = calendar.startOfDay(for: from)
        let lastIncluded = to.addingTimeInterval(-0.001)
        guard let dailyTo = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: lastIncluded)) else {
            call.reject("无法确定读取历日。", "INVALID_RANGE")
            return
        }
        let firstDay = Self.day(from, zone: calendar.timeZone)
        let lastDay = Self.day(lastIncluded, zone: calendar.timeZone)
        let group = DispatchGroup()
        let queue = DispatchQueue(label: "app.fangkun.health.result")
        var workouts: [[String: Any]] = []
        var health: [[String: Any]] = []
        var notes = ["HealthKit只返回可读取的样本，空结果不能区分无数据和未开放读取权限。",
                     "睡眠按原记录结束日期归属；缺少原记录时区时使用手机当前时区，可能与健康App整夜统计不同。",
                     "睡眠和步数按所选日期完整历日读取，今天截至读取时刻；不会用首日半天读数覆盖已有全天记录。",
                     "步数按原始来源分别累计，未把手机和手表的步数直接相加。"]
        var truncated = false
        var incompleteTypes: Set<String> = []
        var successes = 0

        func query(_ type: HKSampleType, label: String, readPredicate: NSPredicate? = nil, consume: @escaping ([HKSample]) -> Void) {
            group.enter()
            let request = HKSampleQuery(sampleType: type, predicate: readPredicate ?? predicate, limit: sampleLimit,
                                        sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]) { _, samples, error in
                queue.async {
                    if error != nil { notes.append("\(label)读取失败，该类型没有作为成功数据导入。") }
                    else {
                        successes += 1
                        let rows = samples ?? []
                        if rows.count == self.sampleLimit {
                            truncated = true
                            if label == "睡眠" { incompleteTypes.insert("SLEEP_STAGE") }
                        }
                        consume(rows)
                    }
                    group.leave()
                }
            }
            self.store.execute(request)
        }

        query(HKObjectType.workoutType(), label: "训练") { samples in
            for case let workout as HKWorkout in samples {
                var row = Self.source(workout)
                row["sport"] = Self.sport(workout.workoutActivityType)
                row["durationSec"] = workout.duration // Seconds as Double, without rounding.
                if let distance = workout.totalDistance { row["distanceM"] = distance.doubleValue(for: .meter()) }
                else { row["distanceM"] = NSNull() }
                if let energy = workout.totalEnergyBurned { row["energyKcal"] = energy.doubleValue(for: .kilocalorie()) }
                else { row["energyKcal"] = NSNull() }
                workouts.append(row)
            }
        }
        let quantities: [(HKQuantityTypeIdentifier, String, HKUnit, String)] = [
            (.restingHeartRate, "RHR", HKUnit.count().unitDivided(by: .minute()), "bpm"),
            (.heartRateVariabilitySDNN, "HRV_SDNN", HKUnit.secondUnit(with: .milli), "ms")
        ]
        for (identifier, metric, unit, unitName) in quantities {
            guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { continue }
            query(type, label: metric) { samples in
                for case let sample as HKQuantitySample in samples {
                    var row = Self.source(sample)
                    row["metric"] = metric
                    row["day"] = Self.day(sample.startDate, zone: Self.zone(sample))
                    row["value"] = sample.quantity.doubleValue(for: unit)
                    row["unit"] = unitName
                    health.append(row)
                }
            }
        }
        if let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            // A one-day query margin accommodates overnight samples and recorded time zones.
            // Only records whose original end date is in the selected dates are returned.
            let sleepPredicate = HKQuery.predicateForSamples(withStart: dailyFrom.addingTimeInterval(-86_400), end: dailyTo.addingTimeInterval(86_400), options: [])
            query(type, label: "睡眠", readPredicate: sleepPredicate) { samples in
                for case let sample as HKCategorySample in samples {
                    let sampleDay = Self.day(sample.endDate, zone: Self.zone(sample))
                    guard sampleDay >= firstDay && sampleDay <= lastDay else { continue }
                    var row = Self.source(sample)
                    row["metric"] = "SLEEP_STAGE"
                    row["stage"] = Self.sleepStage(sample.value)
                    row["day"] = sampleDay
                    row["value"] = NSNull()
                    row["unit"] = "s"
                    health.append(row)
                }
            }
        }
        if let type = HKObjectType.quantityType(forIdentifier: .stepCount) {
            group.enter()
            let stepPredicate = HKQuery.predicateForSamples(withStart: dailyFrom, end: dailyTo, options: [])
            let stepQuery = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: stepPredicate,
                options: [.cumulativeSum, .separateBySource], anchorDate: dailyFrom, intervalComponents: DateComponents(day: 1))
            stepQuery.initialResultsHandler = { _, collection, error in
                queue.async {
                    if error != nil { notes.append("步数读取失败，未以0代替。") }
                    else if let collection {
                        successes += 1
                        collection.enumerateStatistics(from: dailyFrom, to: dailyTo.addingTimeInterval(-0.001)) { statistic, _ in
                            for source in statistic.sources ?? [] {
                                guard let sum = statistic.sumQuantity(for: source) else { continue }
                                let day = Self.day(statistic.startDate, zone: calendar.timeZone)
                                health.append([
                                    "id": "steps:\(day)", "originId": source.bundleIdentifier, "originName": source.name,
                                    "metric": "STEPS", "day": day, "value": sum.doubleValue(for: .count()), "unit": "count",
                                    "startAt": Self.iso(statistic.startDate), "endAt": Self.iso(min(statistic.endDate, Date()))
                                ])
                            }
                        }
                    }
                    group.leave()
                }
            }
            store.execute(stepQuery)
        }
        group.notify(queue: queue) {
            guard successes > 0 else {
                call.reject("所有健康类型均读取失败，请检查系统健康权限后重试。", "HEALTHKIT_READ_FAILED")
                return
            }
            call.resolve(["schemaVersion": 1, "provider": self.provider, "readAt": Self.iso(Date()),
                          "workouts": workouts, "health": health, "notes": notes, "truncated": truncated, "incompleteTypes": Array(incompleteTypes)])
        }
    }
}
