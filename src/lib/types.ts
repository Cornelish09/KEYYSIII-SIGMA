export type Step = 0 | 1 | 2 | 3 | 4 | 5;

export type Place = {
  id: string;
  name: string;
  description: string;
  image: string;       // Versi Baru
  locationUrl: string;
  tags: string[];
  budget?: string;
  openHours?: string;
  swot?: string;
  imageUrl?: string;   // Jaga-jaga Versi Lama
};

export type Outfit = {
  id: string;
  // Kita support dua-duanya biar gak error
  name: string;        // Versi Baru
  title?: string;      // Versi Lama
  
  description: string; // Versi Baru
  vibeNote?: string;   // Versi Lama
  
  image: string;       // Versi Baru
  
  style: string;
  palette?: string[];  // Warna (Bulat-bulat)
  
  herColors?: string[]; // Sisa lama
  himColors?: string[]; // Sisa lama
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
  admin: {
    passcode: string;
  };
};

export type AppState = {
  step: Step;
  unlocked: boolean;
  chosenPlaceId?: string; // Isinya JSON string: {dinner: 'id', ...}
  chosenOutfitId?: string;
};