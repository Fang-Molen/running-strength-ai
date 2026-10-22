package app.fangkun.health

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView

/** System permission rationale, not a second business sign-in/sync window. */
class HealthPermissionsRationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = TextView(this).apply {
            textSize = 17f
            setPadding(32, 48, 32, 48)
            text = "方坤 · 健康数据读取说明\n\n" +
                "方坤在你主动点击读取时，读取你允许的训练、静息心率、HRV、睡眠、步数，以及训练对应的距离和活动能量。\n\n" +
                "数据先显示在设备连接与同步窗口供核对；只有你确认保存后，才写入当前运动员的方坤记录。" +
                "本模块不向Health Connect写数据，也不在后台自动读取。\n\n" +
                "你可以随时在Health Connect中撤回各项读取权限。撤回权限不会自动删除之前已确认保存的方坤记录；请在方坤记录中管理这些数据。\n\n" +
                "本说明覆盖设备健康读取模块。方坤其他功能的数据使用方式应以发行版的完整隐私政策为准。"
        }
        setContentView(ScrollView(this).apply { addView(text) })
    }
}
