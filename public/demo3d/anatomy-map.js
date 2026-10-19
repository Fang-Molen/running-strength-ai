// Anatomy names are retained from the source meshes. These aliases connect them
// to the existing exercise catalogue; they do not measure activation or fatigue.
export function anatomyMeta(data) {
  const name = data.name || '', n = name.toLowerCase();
  if (!/muscles/.test(data.layer || '')) return null;
  const entry = (k, g, zh) => ({ k, g, zh, name, side: data.side, layer: data.layer, fma: data.fma || null });
  if (/pectoralis major/.test(n)) return /clavicular/.test(n) ? entry('pec_upper', 'chest', '胸大肌锁骨部') : entry('pec_lower', 'chest', '胸大肌胸肋部');
  if (/deltoid/.test(n)) return /clavicular/.test(n) ? entry('delt_front', 'delt_front', '三角肌前束') : /acromial/.test(n) ? entry('delt_side', 'delt_side', '三角肌中束') : entry('delt_rear', 'delt_rear', '三角肌后束');
  if (/biceps brachii/.test(n)) return entry('biceps', 'biceps', /short head/.test(n) ? '肱二头肌短头' : '肱二头肌长头');
  if (/brachialis/.test(n) && !/brachioradialis/.test(n)) return entry('brachialis', 'elbow_flexors', '肱肌');
  if (/triceps brachii/.test(n)) return entry(/long head/.test(n) ? 'triceps_long' : /medial head/.test(n) ? 'triceps_medial' : 'triceps_lat', 'triceps', /long head/.test(n) ? '肱三头肌长头' : /medial head/.test(n) ? '肱三头肌内侧头' : '肱三头肌外侧头');
  if (/trapezius/.test(n)) return /descending/.test(n) ? entry('trap_upper', 'traps', '斜方肌上部') : /ascending/.test(n) ? entry('trap_lower', 'traps', '斜方肌下部') : entry('trap_mid', 'traps', '斜方肌中部');
  if (/latissimus/.test(n)) return entry('lats', 'lats', '背阔肌');
  if (/rhomboid/.test(n)) return entry('rhomboids', 'rhomboids', /minor/.test(n) ? '菱形小肌' : '菱形大肌');
  if (/iliocostalis|longissimus|spinalis thoracis/.test(n)) return entry('erectors', 'erectors', /iliocostalis/.test(n) ? '髂肋肌' : /longissimus/.test(n) ? '最长肌' : '棘肌');
  if (/rectus abdominis/.test(n)) return entry('abs', 'abs', '腹直肌');
  if (/external oblique/.test(n)) return entry('ext_oblique', 'obliques', '腹外斜肌');
  if (/internal oblique/.test(n)) return entry('internal_oblique', 'obliques', '腹内斜肌');
  if (/transversus abdominis/.test(n)) return entry('transversus', 'core', '腹横肌');
  if (/serratus anterior/.test(n)) return entry('serratus', 'obliques', '前锯肌');
  if (/psoas major|iliacus/.test(n)) return entry('iliopsoas', 'hip_flexors', /iliacus/.test(n) ? '髂肌' : '腰大肌');
  if (/gluteus maximus/.test(n)) return entry('glutes', 'glutes', '臀大肌');
  if (/gluteus medius/.test(n)) return entry('glute_med', 'glute_med', '臀中肌');
  if (/gluteus minimus/.test(n)) return entry('glute_min', 'hip_abductors', '臀小肌');
  if (/rectus femoris/.test(n)) return entry('rectus_fem', 'quads', '股直肌');
  if (/vastus lateralis/.test(n)) return entry('vastus_lat', 'quads', '股外侧肌');
  if (/vastus medialis/.test(n)) return entry('vastus_med', 'quads', '股内侧肌');
  if (/vastus intermedius/.test(n)) return entry('vastus_intermedius', 'quads', '股中间肌');
  if (/biceps femoris/.test(n)) return entry('biceps_fem', 'hamstrings', /short head/.test(n) ? '股二头肌短头' : '股二头肌长头');
  if (/semitendinosus|semimembranosus/.test(n)) return entry('semitend', 'hamstrings', /semitendinosus/.test(n) ? '半腱肌' : '半膜肌');
  if (/adductor|gracilis|pectineus/.test(n) && !/hallucis|pollicis/.test(n)) return entry('adductors', 'adductors', /gracilis/.test(n) ? '股薄肌' : /pectineus/.test(n) ? '耻骨肌' : /magnus/.test(n) ? '大收肌' : /longus/.test(n) ? '长收肌' : '短收肌');
  if (/gastrocnemius/.test(n)) return /medial/.test(n) ? entry('gastroc_med', 'calves', '腓肠肌内侧头') : entry('gastroc_lat', 'calves', '腓肠肌外侧头');
  if (/soleus/.test(n)) return entry('soleus', 'calves', '比目鱼肌');
  if (/tibialis anterior/.test(n)) return entry('tibialis', null, '胫骨前肌');
  if (/fibularis/.test(n)) return entry('peroneals', 'calves', /brevis/.test(n) ? '腓骨短肌' : /tertius/.test(n) ? '第三腓骨肌' : '腓骨长肌');
  if (/foot|hallucis/.test(n) && !/longus/.test(n)) return entry('foot_intrinsic', 'feet', /abductor hallucis/.test(n) ? '拇展肌' : /flexor digitorum brevis/.test(n) ? '趾短屈肌' : /flexor hallucis brevis/.test(n) ? '拇短屈肌' : /adductor hallucis/.test(n) ? '拇收肌' : /interosse/.test(n) ? '足底骨间肌' : /lumbrical/.test(n) ? '足蚓状肌' : /abductor digiti/.test(n) ? '小趾展肌' : /extensor hallucis brevis/.test(n) ? '拇短伸肌' : '足部内在肌');
  if (/flexor carpi|flexor digitorum (superficialis|profundus)|flexor pollicis longus|palmaris longus|pronator/.test(n)) return entry('forearm_flex', 'forearm', '前臂屈肌群');
  if (/extensor carpi|extensor digitorum$|extensor digiti minimi|extensor pollicis|brachioradialis/.test(n)) return entry('forearm_ext', 'forearm', '前臂伸肌群');
  // Keep distinct, source-named meshes selectable without inventing an exercise mapping.
  return entry(name.toLowerCase().replace(/[^a-z0-9]+/g, '_'), null, name);
}

export const matchesMuscle = (meta, key) => !!key && (meta.k === key || meta.g === key);
export function muscleRole(meta, primary = [], secondary = []) {
  if (primary.some(key => matchesMuscle(meta, key))) return 'main';
  if (secondary.some(key => matchesMuscle(meta, key))) return 'aux';
  return 'none';
}

/** A catalogue group selection can disclose its deep members by removing the
 * named overlying structures, without rendering muscle through opaque tissue. */
export function coveringGroups(key) {
  // The external-oblique mesh includes the anterior aponeurosis over the rectus sheath.
  return ({ abs: ['ext_oblique'], soleus: ['gastroc_med', 'gastroc_lat'], rhomboids: ['trap_upper', 'trap_mid', 'trap_lower'],
    erectors: ['lats', 'trap_mid', 'trap_lower'], vastus_intermedius: ['rectus_fem'],
    iliopsoas: ['abs', 'ext_oblique'], transversus: ['abs', 'ext_oblique', 'internal_oblique'] })[key] || [];
}
