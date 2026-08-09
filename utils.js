// ═══════════════════════════════════════════════
//  SUPABASE
// ═══════════════════════════════════════════════
const SUPA_URL = 'https://vsxoeqyqhmrljfahqcsb.supabase.co';
const SUPA_KEY = 'sb_publishable_kBVUT2phcWigWcQNY7PkAQ_xOg72_kt';
const supa = supabase.createClient(SUPA_URL, SUPA_KEY);
const CONFIG_KEY = 'clemar_visita_config_v1';

let currentUser = null;
let relatorios = [];       // lista completa carregada do banco
let currentId  = null;     // id do relatório em edição
let currentRelatorio = null; // objeto completo do relatório em edição (com fotos)
let _pendingFotoId = null;

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

// ═══════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════
