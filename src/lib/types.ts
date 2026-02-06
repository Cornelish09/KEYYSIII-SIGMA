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

// ✅ TAMBAHAN: Photo Template Types
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
};