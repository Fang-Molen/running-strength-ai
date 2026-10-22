package app.fangkun.health

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.reflect.KClass

@CapacitorPlugin(name = "FangkunHealth")
class FangkunHealthPlugin : Plugin() {
    private val provider = "health_connect"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val permissionContract = PermissionController.createRequestPermissionResultContract()
    private var permissionInFlight = false
    private var pendingPermissionCall: PluginCall? = null
    private val pendingCalls = mutableSetOf<PluginCall>() // Main dispatcher only.

    private val primaryTypes = setOf(
        ExerciseSessionRecord::class, RestingHeartRateRecord::class,
        HeartRateVariabilityRmssdRecord::class, SleepSessionRecord::class, StepsRecord::class
    )
    private val readPermissions = (primaryTypes + setOf(DistanceRecord::class, ActiveCaloriesBurnedRecord::class))
        .map { HealthPermission.getReadPermission(it) }.toSet()

    private fun accepts(call: PluginCall): Boolean {
        if (call.getString("provider") == provider) return true
        call.reject("Health Connect只能处理health_connect来源。", "PROVIDER_MISMATCH")
        return false
    }

    private fun status(state: String, message: String): JSObject = JSObject().apply {
        put("provider", provider); put("state", state); put("message", message)
    }

    private fun availability(): JSObject? = when (HealthConnectClient.getSdkStatus(context)) {
        HealthConnectClient.SDK_AVAILABLE -> null
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> status("provider_unavailable", "请先安装或更新Health Connect，再返回方坤。")
        else -> status("provider_unavailable", "此设备不支持Health Connect；需要受支持的Android设备及Google Play服务。")
    }

    private fun permissionStatus(granted: Set<String>): JSObject {
        val readable = primaryTypes.any { HealthPermission.getReadPermission(it) in granted }
        return when {
            !readable -> status("permissions_required", "请在系统健康页面允许至少一种数据读取。")
            !granted.containsAll(readPermissions) -> status("available", "已开放部分项目，将只读取获准的数据；未授权项目保留为空。")
            else -> status("available", "系统健康读取权限可用，可以开始读取并核对。")
        }
    }

    /** Every native async branch either resolves or rejects its own call. */
    private fun runCall(call: PluginCall, block: suspend () -> Unit) {
        scope.launch {
            pendingCalls.add(call)
            try { block() }
            catch (_: CancellationException) { call.reject("健康读取已取消，请返回应用后重试。", "HEALTH_CANCELLED") }
            catch (_: SecurityException) { call.reject("读取权限已改变，请重新检查系统健康权限。", "HEALTH_PERMISSION_LOST") }
            catch (_: Exception) { call.reject("系统健康读取未完成，请检查权限和服务状态后重试。", "HEALTH_READ_FAILED") }
            finally { pendingCalls.remove(call) }
        }
    }

    @PluginMethod
    fun checkAvailability(call: PluginCall) {
        if (!accepts(call)) return
        runCall(call) {
            val unavailable = availability()
            if (unavailable != null) call.resolve(unavailable)
            else call.resolve(permissionStatus(HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()))
        }
    }

    @PluginMethod
    fun requestReadPermissions(call: PluginCall) {
        if (!accepts(call)) return
        runCall(call) {
            val unavailable = availability()
            if (unavailable != null) { call.resolve(unavailable); return@runCall }
            if (permissionInFlight) { call.reject("已有健康授权页面正在处理。", "PERMISSION_BUSY"); return@runCall }
            val granted = HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()
            if (granted.containsAll(readPermissions)) { call.resolve(permissionStatus(granted)); return@runCall }
            permissionInFlight = true
            pendingPermissionCall = call
            try {
                // runCall uses the Main dispatcher, as required for launching the system sheet.
                startActivityForResult(call, permissionContract.createIntent(context, readPermissions), "permissionsResult")
            } catch (error: Exception) {
                permissionInFlight = false
                pendingPermissionCall = null
                throw error
            }
        }
    }

    @ActivityCallback
    private fun permissionsResult(call: PluginCall?, result: ActivityResult) {
        permissionInFlight = false
        val pending = call ?: pendingPermissionCall
        pendingPermissionCall = null
        if (pending == null) return
        // Recheck live grants; a returned Activity result alone is not proof of permission.
        runCall(pending) {
            permissionContract.parseResult(result.resultCode, result.data)
            val unavailable = availability()
            if (unavailable != null) pending.resolve(unavailable)
            else pending.resolve(permissionStatus(HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()))
        }
    }

    private data class Batch<T>(val rows: List<T>, val truncated: Boolean)

    private suspend fun <T : Record> readPages(
        client: HealthConnectClient, type: KClass<T>, from: Instant, to: Instant, limit: Int = 4_000
    ): Batch<T> {
        val rows = mutableListOf<T>()
        var token: String? = null
        do {
            val page = client.readRecords(ReadRecordsRequest(
                recordType = type, timeRangeFilter = TimeRangeFilter.between(from, to),
                pageSize = minOf(500, limit - rows.size), pageToken = token
            ))
            rows.addAll(page.records)
            token = page.pageToken
            if (rows.size >= limit) return Batch(rows, token != null)
        } while (token != null)
        return Batch(rows, false)
    }

    private fun source(id: String, metadata: Metadata, from: Instant, to: Instant): JSObject = JSObject().apply {
        put("id", id)
        put("originId", metadata.dataOrigin.packageName)
        // The package is the original data origin. Never label every source as Google or a watch brand.
        put("originName", metadata.dataOrigin.packageName)
        put("startAt", from.toString()); put("endAt", to.toString())
    }

    private fun day(time: Instant, offset: ZoneOffset?): String = time.atZone(offset ?: ZoneId.systemDefault()).toLocalDate().toString()

    private fun sport(type: Int): String = when (type) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING, ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "running"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING, ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "strength"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "walking"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING, ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "cycling"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER, ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL -> "swimming"
        else -> "unknown"
    }

    private fun sleepStage(type: Int): String = when (type) {
        SleepSessionRecord.STAGE_TYPE_SLEEPING -> "asleep"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
        SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
        SleepSessionRecord.STAGE_TYPE_REM -> "rem"
        SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> "awake"
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "out_of_bed"
        else -> "unknown"
    }

    @PluginMethod
    fun readRecords(call: PluginCall) {
        if (!accepts(call)) return
        val from: Instant
        val to: Instant
        try {
            from = Instant.parse(call.getString("from")); to = Instant.parse(call.getString("to"))
            require(from < to && Duration.between(from, to) <= Duration.ofDays(31))
        } catch (_: Exception) { call.reject("读取范围须为有效起止时间且不超过31天。", "INVALID_RANGE"); return }
        runCall(call) {
            val unavailable = availability()
            if (unavailable != null) { call.reject("此设备上的Health Connect暂不可用。", "HEALTH_UNAVAILABLE"); return@runCall }
            val result = withTimeout(55_000) { withContext(Dispatchers.IO) { readHealth(from, to) } }
            call.resolve(result)
        }
    }

    private suspend fun readHealth(from: Instant, to: Instant): JSObject {
        val client = HealthConnectClient.getOrCreate(context)
        val granted = client.permissionController.getGrantedPermissions()
        if (primaryTypes.none { HealthPermission.getReadPermission(it) in granted }) throw SecurityException()
        val workouts = JSArray()
        val health = JSArray()
        val notes = mutableSetOf(
            "仅前台读取获准项目；本模块未申请后台或30天前历史读取权限。",
            "Android训练时长为原始起止时间之差，可能包含暂停；未把它改称移动时长。",
            "训练距离与活动能量仅按同一原始来源和训练时间区间聚合；没有读数时保留空值。",
            "睡眠按会话结束日期归属；缺少原始时区时使用手机当前时区。",
            "睡眠和步数按所选日期完整历日读取，今天截至读取时刻；日指标限最近30个历日，避免首日半天数据覆盖全天值。"
        )
        var truncated = false
        val incompleteTypes = mutableSetOf<String>()
        val zone = ZoneId.systemDefault()
        val firstDate = maxOf(from.atZone(zone).toLocalDate(), Instant.now().atZone(zone).toLocalDate().minusDays(29))
        val lastDate = to.minusNanos(1).atZone(zone).toLocalDate()
        var successes = 0

        suspend fun attempt(label: String, block: suspend () -> Unit) {
            try { block(); successes += 1 }
            catch (error: CancellationException) { throw error }
            catch (_: SecurityException) { notes.add("$label 权限不足或已撤回，未以0代替。") }
            catch (_: Exception) { notes.add("$label 读取失败，未作为成功数据导入。") }
        }

        if (HealthPermission.getReadPermission(ExerciseSessionRecord::class) in granted) attempt("训练") {
            val batch = readPages(client, ExerciseSessionRecord::class, from, to, 500)
            truncated = truncated || batch.truncated
            for (record in batch.rows) {
                val duration = Duration.between(record.startTime, record.endTime)
                val row = source(record.metadata.id, record.metadata, record.startTime, record.endTime).apply {
                    put("sport", sport(record.exerciseType))
                    put("durationSec", duration.seconds.toDouble() + duration.nano / 1_000_000_000.0)
                    put("distanceM", JSONObject.NULL); put("energyKcal", JSONObject.NULL)
                }
                val metrics = mutableSetOf<AggregateMetric<*>>()
                if (HealthPermission.getReadPermission(DistanceRecord::class) in granted) metrics.add(DistanceRecord.DISTANCE_TOTAL)
                if (HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class) in granted) metrics.add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
                if (metrics.isNotEmpty()) {
                    try {
                        val totals = client.aggregate(AggregateRequest(metrics, TimeRangeFilter.between(record.startTime, record.endTime), setOf(record.metadata.dataOrigin)))
                        totals[DistanceRecord.DISTANCE_TOTAL]?.let { row.put("distanceM", it.inMeters) }
                        totals[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.let { row.put("energyKcal", it.inKilocalories) }
                    } catch (error: CancellationException) { throw error }
                    catch (_: Exception) { notes.add("部分训练的附属距离或活动能量未读到，字段保留为空。") }
                }
                workouts.put(row)
            }
        }
        if (HealthPermission.getReadPermission(RestingHeartRateRecord::class) in granted) attempt("静息心率") {
            val batch = readPages(client, RestingHeartRateRecord::class, from, to)
            truncated = truncated || batch.truncated
            for (record in batch.rows) health.put(source(record.metadata.id, record.metadata, record.time, record.time).apply {
                put("metric", "RHR"); put("value", record.beatsPerMinute); put("unit", "bpm")
                put("day", day(record.time, record.zoneOffset))
            })
        }
        if (HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class) in granted) attempt("HRV") {
            val batch = readPages(client, HeartRateVariabilityRmssdRecord::class, from, to)
            truncated = truncated || batch.truncated
            for (record in batch.rows) health.put(source(record.metadata.id, record.metadata, record.time, record.time).apply {
                put("metric", "HRV_RMSSD"); put("value", record.heartRateVariabilityMillis); put("unit", "ms")
                put("day", day(record.time, record.zoneOffset))
            })
        }
        if (HealthPermission.getReadPermission(SleepSessionRecord::class) in granted && firstDate <= lastDate) attempt("睡眠") {
            val batch = readPages(client, SleepSessionRecord::class,
                firstDate.minusDays(1).atStartOfDay(zone).toInstant(), lastDate.plusDays(2).atStartOfDay(zone).toInstant(), 1_000)
            truncated = truncated || batch.truncated
            if (batch.truncated) incompleteTypes.add("SLEEP_STAGE")
            var stageCount = 0
            for (record in batch.rows) {
                val recordDay = day(record.endTime, record.endZoneOffset)
                if (recordDay < firstDate.toString() || recordDay > lastDate.toString()) continue
                if (record.stages.isEmpty()) { notes.add("部分睡眠会话没有分期，未将整个卧床区间猜作实际睡眠。"); continue }
                for ((index, stage) in record.stages.withIndex()) {
                    if (stageCount >= 12_000) { truncated = true; incompleteTypes.add("SLEEP_STAGE"); break }
                    stageCount += 1
                    health.put(source("${record.metadata.id}:$index", record.metadata, stage.startTime, stage.endTime).apply {
                        put("metric", "SLEEP_STAGE"); put("stage", sleepStage(stage.stage))
                        put("day", recordDay); put("value", JSONObject.NULL); put("unit", "s")
                    })
                }
            }
        }
        if (HealthPermission.getReadPermission(StepsRecord::class) in granted && firstDate <= lastDate) attempt("步数") {
            var date = firstDate
            while (date <= lastDate) {
                val start = date.atStartOfDay(zone).toInstant()
                val end = minOf(Instant.now(), date.plusDays(1).atStartOfDay(zone).toInstant())
                if (start >= end) { date = date.plusDays(1); continue }
                val totals = client.aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(start, end)))
                // Health Connect's aggregation applies its source-priority deduplication. Do not sum raw StepsRecords.
                totals[StepsRecord.COUNT_TOTAL]?.let { count ->
                    health.put(JSObject().apply {
                        put("id", "steps:$date"); put("originId", "health-connect-system-aggregate")
                        put("originName", "Health Connect系统去重"); put("metric", "STEPS")
                        put("day", date.toString()); put("value", count); put("unit", "count")
                        put("startAt", start.toString()); put("endAt", end.toString())
                    })
                }
                date = date.plusDays(1)
            }
        }
        if (successes == 0) throw IllegalStateException("No permitted type could be read")
        return JSObject().apply {
            put("schemaVersion", 1); put("provider", provider); put("readAt", Instant.now().toString())
            put("workouts", workouts); put("health", health); put("notes", JSArray(notes.toList())); put("truncated", truncated)
            put("incompleteTypes", JSArray(incompleteTypes.toList()))
        }
    }

    override fun handleOnDestroy() {
        pendingPermissionCall?.reject("应用已关闭，健康授权流程取消。", "HEALTH_CANCELLED")
        pendingPermissionCall = null
        permissionInFlight = false
        scope.cancel()
        super.handleOnDestroy()
    }
}
