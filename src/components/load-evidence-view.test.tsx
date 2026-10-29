import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {loadOccurrences} from '@/lib/health/load-evidence'
import {projectAnalysisEvidence} from '@/lib/health/analysis-evidence'
import {context,training} from '@/lib/health/analysis-fixtures'
import {LoadEvidenceView} from './load-evidence-view'
test('没有记录明确提示未知，不展示疲劳评分',()=>{const html=renderToStaticMarkup(createElement(LoadEvidenceView,{sessions:[]}));assert.ok(html.includes('没有可核对的训练'));assert.doesNotMatch(html,/疲劳[：:]\s*\d+/)})
test('显示分项、缺失和版本，不把未知跑量写成零',()=>{const html=renderToStaticMarkup(createElement(LoadEvidenceView,{sessions:loadOccurrences(projectAnalysisEvidence({context,facts:[training({id:'a',revision:2,modality:'RUN',strengthSets:[],runSegments:[]})]}))}));assert.ok(html.includes('距离不完整'));assert.ok(html.includes('距离仅含已知部分'));assert.ok(html.includes('a@2'));assert.ok(!html.includes('0 km'))})
