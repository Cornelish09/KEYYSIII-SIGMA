export type Step = 0 | 1 | 2 | 3 | 4 | 5;

export type Place = {
  id: string;
  name: string;
  description: string;
  image: string;       
  locationUrl: string;
  tags: string[];
  budget?: string;
  openHours?: string;
  swot?: string;
  imageUrl?: string;   
};

export type Outfit = {
  id: string;
  name: string;
  title?: string;      
  description: string; 
  vibeNote?: string;   
  image: string;
  style: string;
  palette?: string[];  
  herColors?: string[]; 
  himColors?: string[]; 
};

// ========================================
// 📸 PHOTOBOX TYPES (PRO MAX)
// ========================================

export type PhotoSlot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PhotoTemplate = {
  id: string;
  name: string;
  imageUrl: string;
  photoCount: number;
  slots: PhotoSlot[];
  canvasWidth: number;
  canvasHeight: number;
  createdAt: string;
};

export type PhotoLayout = 
  | '2-vertical' 
  | '3-vertical' 
  | '4-vertical' 
  | '2x2-grid' 
  | '3x3-grid' 
  | '4-custom';

export type CanvasSize = '4:5' | '9:16' | '1:1' | '707x2000' | 'custom';

export type FilterType = 
  | 'normal' 
  | 'bw' 
  | 'vintage' 
  | 'vibrant' 
  | 'soft' 
  | 'warm';

export type Frame = {
  id: string;
  name: string;
  imageUrl?: string;
  color?: string;
  type: 'color' | 'image';
};

export type Sticker = {
  id: string;
  name: string;
  imageUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
};

export type PhotoCapture = {
  id: string;
  dataUrl: string;
  filter: FilterType;
  timestamp: number;
};

export type TextOverlay = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  rotation: number;
};

export type PhotoboxSession = {
  id: string;
  rawPhotos: string[]; // URLs
  finalDesign?: string; // URL
  timestamp: number;
  layout: PhotoLayout;
  photoCount: number;
  frameId: string;
  stickerCount: number;
  textCount: number;
  userId?: string;
};

// ========================================
// 🔧 MAIN APP CONFIG
// ========================================

export type ContentConfig = {
  couple: {
    herName: string;
    yourName: string;
  };
  music?: string;
  intro: {
    headline: string;
    subtitle: string;
    splineSceneUrl?: string; 
  };
  game: {
    headline: string;
    subtitle: string;
  };
  letter: {
    text: string;
  };
  places: {
    headline?: string;
    subtitle?: string;
    items: Place[];
  };
  outfits: {
    headline?: string;
    subtitle?: string;
    items: Outfit[];
  };
  // ✅ PHOTOBOX CONFIG (BARU!)
  photobox?: {
    enabled: boolean;
    frames: Frame[];
    stickers: Sticker[];
    templates: PhotoTemplate[];
    canvasSizes: {
      id: string;
      name: string;
      width: number;
      height: number;
    }[];
    watermark?: {
      enabled: boolean;
      text: string;
      imageUrl?: string;
    };
  };
  rundown?: {
    time: string;
    label: string;
    desc: string;
    type: string;
  }[];
  admin: {
    passcode: string;
  };
};

export type AppState = {
  step: Step;
  unlocked: boolean;
  chosenPlaceId?: string; 
  chosenOutfitId?: string;
  photoboxSessionId?: string; // Track current photobox session
};