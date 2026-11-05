import type { Language, MapId, PieceSymbol } from '../engine/types';

export interface TranslationStrings {
  brandTitle: string;
  menuSubtitle: string;
  menuTagline: string;
  btnPlay: string;
  btnMapSelect: string;
  btnSettings: string;
  btnLanguage: string;
  btnCredits: string;
  btnSkipIntro: string;
  btnClose: string;

  // Turn & Status
  whiteToMove: string;
  blackToMove: string;
  whiteToMoveAI: string;
  blackToMoveAI: string;
  whiteInCheck: string;
  blackInCheck: string;
  singlePlayerYouWhite: string;
  singlePlayerYouBlack: string;
  twoPlayerLocal: string;

  // HUD Controls
  btnLobby: string;
  btnMainMenu: string;
  btnPlayAsBlack: string;
  btnPlayAsWhite: string;
  btnAIMove: string;
  btnNewGame: string;
  btnUndo: string;
  btnRestart: string;
  btnHistory: string;
  viewGameplay: string;
  viewOverhead: string;
  viewCinematic: string;
  viewWhite: string;
  viewBlack: string;
  hintText: string;
  capturedSummaryPrefix: string;
  whiteCapturedLabel: string;
  blackCapturedLabel: string;
  historyTitle: string;
  noMovesYet: string;

  // Map Selection Modal
  mapSelectTitle: string;
  mapSelectSubtitle: string;
  mapCathedral: string;
  mapCathedralDesc: string;
  mapWarHall: string;
  mapWarHallDesc: string;
  mapSanctum: string;
  mapSanctumDesc: string;
  btnSelectMap: string;

  // Lobby / Match Setup
  lobbyTitle: string;
  labelGameMode: string;
  modeVsAI: string;
  modeLocal2P: string;
  labelYourFaction: string;
  factionWhite: string;
  factionBlack: string;
  labelAIRank: string;
  diffNovice: string;
  diffKnight: string;
  diffArchmage: string;
  diffGrandmaster: string;
  labelTimeControl: string;
  clockUnlimited: string;
  clock3m: string;
  clock5m: string;
  clock10m: string;
  labelArenaMap: string;
  labelCameraPreset: string;
  camGameplay: string;
  camOverhead: string;
  camCinematic: string;
  btnResumeMatch: string;
  btnStartMatch: string;

  // Settings
  settingsTitle: string;
  settingLanguage: string;
  settingGraphicsQuality: string;
  qualityLow: string;
  qualityMedium: string;
  qualityHigh: string;
  settingVolume: string;
  settingMusic: string;
  settingSfx: string;
  settingCamSensitivity: string;
  settingMagicalFx: string;
  settingReducedMotion: string;
  settingShowCoords: string;
  btnDone: string;

  // Promotion
  promoTitle: string;
  promoQueenSub: string;
  promoRookSub: string;
  promoBishopSub: string;
  promoKnightSub: string;
  pieceNames: Record<PieceSymbol, string>;

  // End-State / Checkmate Overlay
  checkmateBanner: string;
  stalemateBanner: string;
  drawBanner: string;
  checkmateTitle: string;
  stalemateTitle: string;
  drawTitle: string;
  timeoutTitle: string;
  whiteWins: string;
  blackWins: string;
  whiteWinsSubtitle: string;
  blackWinsSubtitle: string;
  drawSubtitlePrefix: string;
  btnRematch: string;
  btnReturnLobby: string;
  btnReviewBoard: string;

  // Credits & Developer Identity
  creditsTitle: string;
  creditsBody: string;
  creditsCreatorLabel: string;
  creditsCreatorRole: string;
  creditsGithubBtn: string;
  creditsSignature: string;
  creditsCopyright: string;
  creditsTechTitle: string;
  creditsLicenseNotice: string;
}

const LANG_STORAGE_KEY = 'mochess_language_v2';

export function getSavedLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'en' || saved === 'id') return saved;
  } catch {
    // Ignore storage errors
  }
  return 'en';
}

export function saveLanguage(lang: Language): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Ignore storage errors
  }
}

export const TRANSLATIONS: Record<Language, TranslationStrings> = {
  en: {
    brandTitle: 'WIZARD CHESS',
    menuSubtitle: 'MOCHESS — ARCANE KINGDOM',
    menuTagline: 'Command living stone-and-gold armies across ancient medieval battle halls.',
    btnPlay: 'Play',
    btnMapSelect: 'Map Selection',
    btnSettings: 'Settings',
    btnLanguage: 'Language',
    btnCredits: 'Credits',
    btnSkipIntro: 'Skip Intro',
    btnClose: 'Close',

    whiteToMove: 'White to Move',
    blackToMove: 'Black to Move',
    whiteToMoveAI: 'White to Move (AI)...',
    blackToMoveAI: 'Black to Move (AI)...',
    whiteInCheck: 'White to Move (CHECK)',
    blackInCheck: 'Black to Move (CHECK)',
    singlePlayerYouWhite: 'Single Player • You: White',
    singlePlayerYouBlack: 'Single Player • You: Black',
    twoPlayerLocal: 'Two Player • Local',

    btnLobby: 'Lobby',
    btnMainMenu: 'Main Menu',
    btnPlayAsBlack: 'Play as Black',
    btnPlayAsWhite: 'Play as White',
    btnAIMove: 'AI Move',
    btnNewGame: 'New Game',
    btnUndo: 'Undo',
    btnRestart: 'Restart',
    btnHistory: 'History',
    viewGameplay: 'View: Gameplay',
    viewOverhead: 'View: Overhead',
    viewCinematic: 'View: 3/4',
    viewWhite: 'View: White',
    viewBlack: 'View: Black',
    hintText: 'Select a piece to view legal moves • Scroll to zoom • Subtle drag to tilt',
    capturedSummaryPrefix: 'Captured',
    whiteCapturedLabel: 'White Captured:',
    blackCapturedLabel: 'Black Captured:',
    historyTitle: 'Chronicle of Moves',
    noMovesYet: 'No moves played yet.',

    mapSelectTitle: 'Select Battle Arena',
    mapSelectSubtitle: 'Choose a 3D realm with its own architecture, lighting mood, and board craftsmanship.',
    mapCathedral: 'Gothic Cathedral',
    mapCathedralDesc: 'Ancient vaulted limestone nave illuminated by roaring wrought-iron fire braziers and stained glass.',
    mapWarHall: 'Royal War Hall',
    mapWarHallDesc: 'Fortified crimson-and-gold throne bastion with royal banners, dark granite pillars, and hearth firelight.',
    mapSanctum: 'Arcane Sanctum',
    mapSanctumDesc: 'Deep obsidian chamber encircled by levitating mana crystals, glowing ley-line runes, and mystic blue flames.',
    btnSelectMap: 'Select Arena',

    lobbyTitle: 'Match Setup — Sanctum Lobby',
    labelGameMode: 'Game Mode',
    modeVsAI: 'Single Player (vs AI)',
    modeLocal2P: 'Two Player (Pass & Play)',
    labelYourFaction: 'Your Faction',
    factionWhite: 'White & Gold',
    factionBlack: 'Black & Gold',
    labelAIRank: 'AI Opponent Rank',
    diffNovice: 'Novice',
    diffKnight: 'Knight',
    diffArchmage: 'Archmage',
    diffGrandmaster: 'Grandmaster',
    labelTimeControl: 'Time Control',
    clockUnlimited: 'Unlimited',
    clock3m: '3m Blitz',
    clock5m: '5m Blitz',
    clock10m: '10m Rapid',
    labelArenaMap: 'Battle Arena (Map)',
    labelCameraPreset: 'Camera Perspective',
    camGameplay: 'Strategic Top-Down',
    camOverhead: 'Direct Overhead',
    camCinematic: '3/4 Showcase',
    btnResumeMatch: 'Resume Match',
    btnStartMatch: 'Start Match',

    settingsTitle: 'Settings & Configuration',
    settingLanguage: 'Language / Bahasa',
    settingGraphicsQuality: 'Graphics Quality',
    qualityLow: 'Low',
    qualityMedium: 'Medium',
    qualityHigh: 'High',
    settingVolume: 'Master Audio Volume',
    settingMusic: 'Ambient Cathedral Music',
    settingSfx: 'Battle Sound Effects (SFX)',
    settingCamSensitivity: 'Camera & Zoom Sensitivity',
    settingMagicalFx: 'Combat FX & Fire Particles',
    settingReducedMotion: 'Reduced Motion (Instant Camera & Moves)',
    settingShowCoords: 'Show Board Coordinates (A–H, 1–8)',
    btnDone: 'Done',

    promoTitle: 'Ascension — Choose Promotion Piece',
    promoQueenSub: 'Royal Sovereign',
    promoRookSub: 'Citadel Keep',
    promoBishopSub: 'Cathedral Prelate',
    promoKnightSub: 'Crusader Destrier',
    pieceNames: {
      p: 'Pawn',
      n: 'Knight',
      b: 'Bishop',
      r: 'Rook',
      q: 'Queen',
      k: 'King'
    },

    checkmateBanner: 'Checkmate',
    stalemateBanner: 'Stalemate',
    drawBanner: 'Match Drawn',
    checkmateTitle: 'CHECKMATE',
    stalemateTitle: 'STALEMATE',
    drawTitle: 'MATCH DRAWN',
    timeoutTitle: 'TIME EXPIRED',
    whiteWins: 'White Wins',
    blackWins: 'Black Wins',
    whiteWinsSubtitle: 'The White & Gold Army triumphs in the Sanctum!',
    blackWinsSubtitle: 'The Black & Gold Army triumphs in the Sanctum!',
    drawSubtitlePrefix: 'The battle concludes in a draw by',
    btnRematch: 'Rematch',
    btnReturnLobby: 'Return to Lobby',
    btnReviewBoard: 'Review Board',

    creditsTitle: 'Credits — MoChess: Arcane Kingdom',
    creditsBody:
      'Original 3D sculpted fantasy chess experience built with Three.js, TypeScript, Blender procedural asset pipeline, 2K PBR textures, role-specific battle animations, and an authoritative chess.js + Web Worker AI engine.',
    creditsCreatorLabel: 'Creator & Lead Developer',
    creditsCreatorRole: 'Game Design • 3D Architecture • Systems Engineering',
    creditsGithubBtn: 'github.com/dimasmong',
    creditsSignature: 'Crafted with ❤️ by Dimas Mong',
    creditsCopyright: '© 2026 Dimas Mong. Licensed under the MIT License.',
    creditsTechTitle: 'Open-Source Attribution & Stack',
    creditsLicenseNotice:
      'Powered by Three.js (MIT), chess.js (BSD-2-Clause), TypeScript (Apache-2.0), Vite (MIT), and Blender 3D Pipeline.'
  },
  id: {
    brandTitle: 'CATUR PENYIHIR',
    menuSubtitle: 'MOCHESS — KERAJAAN ARKANA',
    menuTagline: 'Pimpin pasukan batu-dan-emas hidup di aula pertempuran abad pertengahan kuno.',
    btnPlay: 'Main Sekarang',
    btnMapSelect: 'Pilihan Peta',
    btnSettings: 'Pengaturan',
    btnLanguage: 'Bahasa',
    btnCredits: 'Kredit',
    btnSkipIntro: 'Lewati Intro',
    btnClose: 'Tutup',

    whiteToMove: 'Giliran Putih',
    blackToMove: 'Giliran Hitam',
    whiteToMoveAI: 'Giliran Putih (AI)...',
    blackToMoveAI: 'Giliran Hitam (AI)...',
    whiteInCheck: 'Giliran Putih (SKAK)',
    blackInCheck: 'Giliran Hitam (SKAK)',
    singlePlayerYouWhite: '1 Pemain • Anda: Putih',
    singlePlayerYouBlack: '1 Pemain • Anda: Hitam',
    twoPlayerLocal: '2 Pemain • Lokal',

    btnLobby: 'Lobi',
    btnMainMenu: 'Menu Utama',
    btnPlayAsBlack: 'Main Hitam',
    btnPlayAsWhite: 'Main Putih',
    btnAIMove: 'Langkah AI',
    btnNewGame: 'Permainan Baru',
    btnUndo: 'Urung',
    btnRestart: 'Ulangi',
    btnHistory: 'Riwayat',
    viewGameplay: 'Kamera: Strategis',
    viewOverhead: 'Kamera: Atas',
    viewCinematic: 'Kamera: 3/4',
    viewWhite: 'Kamera: Putih',
    viewBlack: 'Kamera: Hitam',
    hintText: 'Pilih bidak untuk melihat langkah sah • Gulir untuk zoom • Geser halus untuk memiringkan',
    capturedSummaryPrefix: 'Tangkapan',
    whiteCapturedLabel: 'Ditangkap Putih:',
    blackCapturedLabel: 'Ditangkap Hitam:',
    historyTitle: 'Kronik Langkah',
    noMovesYet: 'Belum ada langkah dimainkan.',

    mapSelectTitle: 'Pilih Arena Pertempuran',
    mapSelectSubtitle: 'Pilih dunia 3D dengan arsitektur, suasana pencahayaan, dan papan catur yang unik.',
    mapCathedral: 'Katedral Gotik',
    mapCathedralDesc: 'Aula batu kapur kuno yang diterangi tungku api besi tempa yang berkobar dan kaca patri.',
    mapWarHall: 'Aula Perang Kerajaan',
    mapWarHallDesc: 'Benteng takhta merah-dan-emas dengan panji kerajaan, pilar granit gelap, dan perapian hangat.',
    mapSanctum: 'Sanktum Arkana',
    mapSanctumDesc: 'Ruang obsidian dalam yang dikelilingi kristal mana melayang, rune bercahaya, dan api biru mistis.',
    btnSelectMap: 'Pilih Arena',

    lobbyTitle: 'Pengaturan Laga — Lobi Sanktum',
    labelGameMode: 'Mode Permainan',
    modeVsAI: 'Satu Pemain (vs AI)',
    modeLocal2P: 'Dua Pemain (Lokal)',
    labelYourFaction: 'Faksi Anda',
    factionWhite: 'Putih & Emas',
    factionBlack: 'Hitam & Emas',
    labelAIRank: 'Peringkat Lawan AI',
    diffNovice: 'Pemula',
    diffKnight: 'Kria',
    diffArchmage: 'Penyihir Agung',
    diffGrandmaster: 'Grandmaster',
    labelTimeControl: 'Kontrol Waktu',
    clockUnlimited: 'Tanpa Batas',
    clock3m: '3m Kilat',
    clock5m: '5m Kilat',
    clock10m: '10m Cepat',
    labelArenaMap: 'Arena Pertempuran (Peta)',
    labelCameraPreset: 'Perspektif Kamera',
    camGameplay: 'Strategis Atas',
    camOverhead: 'Tepat Dari Atas',
    camCinematic: 'Sinematik 3/4',
    btnResumeMatch: 'Lanjutkan Laga',
    btnStartMatch: 'Mulai Laga',

    settingsTitle: 'Pengaturan & Konfigurasi',
    settingLanguage: 'Bahasa / Language',
    settingGraphicsQuality: 'Kualitas Grafik',
    qualityLow: 'Rendah',
    qualityMedium: 'Sedang',
    qualityHigh: 'Tinggi',
    settingVolume: 'Volume Audio Utama',
    settingMusic: 'Musik Ambien Katedral',
    settingSfx: 'Efek Suara Pertempuran (SFX)',
    settingCamSensitivity: 'Sensitivitas Kamera & Zoom',
    settingMagicalFx: 'Efek Tempur & Partikel Api',
    settingReducedMotion: 'Kurangi Gerakan (Kamera & Langkah Instan)',
    settingShowCoords: 'Tampilkan Koordinat Papan (A–H, 1–8)',
    btnDone: 'Selesai',

    promoTitle: 'Kenaikan Pangkat — Pilih Bidak Promosi',
    promoQueenSub: 'Penguasa Kerajaan',
    promoRookSub: 'Benteng Sitadel',
    promoBishopSub: 'Prelat Katedral',
    promoKnightSub: 'Kavaleri Salib',
    pieceNames: {
      p: 'Pion',
      n: 'Kuda',
      b: 'Gajah',
      r: 'Benteng',
      q: 'Menteri',
      k: 'Raja'
    },

    checkmateBanner: 'Skakmat',
    stalemateBanner: 'Pat (Stalemate)',
    drawBanner: 'Pertandingan Seri',
    checkmateTitle: 'SKAKMAT',
    stalemateTitle: 'PAT (STALEMATE)',
    drawTitle: 'PERTANDINGAN SERI',
    timeoutTitle: 'WAKTU HABIS',
    whiteWins: 'Putih Menang',
    blackWins: 'Hitam Menang',
    whiteWinsSubtitle: 'Pasukan Putih & Emas berjaya di Sanktum!',
    blackWinsSubtitle: 'Pasukan Hitam & Emas berjaya di Sanktum!',
    drawSubtitlePrefix: 'Pertempuran berakhir seri karena',
    btnRematch: 'Tanding Ulang',
    btnReturnLobby: 'Kembali ke Lobi',
    btnReviewBoard: 'Tinjau Papan',

    creditsTitle: 'Kredit — MoChess: Kerajaan Arkana',
    creditsBody:
      'Pengalaman catur fantasi 3D orisinal yang dibangun dengan Three.js, TypeScript, pipeline aset Blender, tekstur PBR 2K prosedural, animasi tempur khusus peran, serta mesin catur chess.js + AI Web Worker.',
    creditsCreatorLabel: 'Pencipta & Pengembang Utama',
    creditsCreatorRole: 'Desain Permainan • Arsitektur 3D • Rekayasa Sistem',
    creditsGithubBtn: 'github.com/dimasmong',
    creditsSignature: 'Crafted with ❤️ by Dimas Mong',
    creditsCopyright: '© 2026 Dimas Mong. Dilinsensikan di bawah Lisensi MIT.',
    creditsTechTitle: 'Atribusi Open-Source & Teknologi',
    creditsLicenseNotice:
      'Didukung oleh Three.js (MIT), chess.js (BSD-2-Clause), TypeScript (Apache-2.0), Vite (MIT), dan Pipeline 3D Blender.'
  }
};

export function getMapTitle(mapId: MapId, lang: Language): string {
  const t = TRANSLATIONS[lang];
  if (mapId === 'warhall') return t.mapWarHall;
  if (mapId === 'sanctum') return t.mapSanctum;
  return t.mapCathedral;
}
