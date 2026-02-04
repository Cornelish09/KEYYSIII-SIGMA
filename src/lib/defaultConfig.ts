import type { ContentConfig } from "./types";

export const DEFAULT_CONFIG: ContentConfig = {
  couple: {
    herName: "Keyy",
    yourName: "Aku"
  },
  intro: {
    headline: "Halo, keyy! ✨",
    subtitle: "Ada sesuatu yang lucu & interaktif buat kamu. Geser-geser dulu ya 😼",
    splineSceneUrl: "" 
  },
  game: {
    headline: "Mini Game Unlock 🔐",
    subtitle: "Cocokin kartu sampai semua match. Abis itu suratnya kebuka!"
  },
  letter: {
    title: "Surat kecil buat kamu 💌",
    body:
`Hai ${"{HER}"}!

Aku mau ngajak kamu jalan & hangout bareng aku.
Kapan kamu free? Aku pengen quality time yang seru, santai, dan bikin ketawa.

Klik lanjut ya—kamu bakal pilih tempat, terus kita cocokin outfit biar makin gemes 😎

— ${"{YOU}"}`,
    songUrl: "/audio/song.mp3"
  },
  places: {
    headline: "Mau pergi ke mana? 📍",
    subtitle: "Pilih satu tempat dulu, nanti lanjut ke match outfit!",
    items: [
      {
        id: "cafe-1",
        name: "Cafe Cozy",
        description: "Tempat santai, vibes hangat, cocok buat ngobrol lama + dessert.",
        imageUrl: "https://images.unsplash.com/photo-1521017432531-fbd92d768814?auto=format&fit=crop&w=1200&q=80",
        locationUrl: "https://maps.google.com/?q=cafe",
        tags: ["cafe", "dessert", "cozy"],
        budget: "Rp 50k–120k",
        openHours: "10.00–22.00"
      },
      {
        id: "park-1",
        name: "Taman Kota",
        description: "Jalan sore, foto-foto, terus jajan kecil. Simple tapi manis.",
        imageUrl: "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1200&q=80",
        locationUrl: "https://maps.google.com/?q=park",
        tags: ["nature", "walk", "chill"],
        budget: "Rp 0–30k",
        openHours: "06.00–21.00"
      },
      {
        id: "mall-1",
        name: "Mall Hangout",
        description: "Kalau mau aman: makan, nonton, arcade, dan adem.",
        imageUrl: "https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=1200&q=80",
        locationUrl: "https://maps.google.com/?q=mall",
        tags: ["mall", "movie", "arcade"],
        budget: "Rp 80k–250k",
        openHours: "10.00–22.00"
      }
    ]
  },
  outfits: {
    headline: "Match Outfit 👗🧥",
    subtitle: "Biar serasi. Pilih satu combo yang kamu suka.",
    items: [
      {
        id: "outfit-cream-brown",
        title: "Cream x Brown",
        vibeNote: "Soft & warm. Pas buat cafe / sunset vibes.",
        herColors: ["#F5F0E6", "#E7D9C4", "#FFFFFF"],
        himColors: ["#6B4F3B", "#FFFFFF", "#D8C7B2"]
      },
      {
        id: "outfit-black-white",
        title: "Black x White",
        vibeNote: "Clean, classy, gampang dipaduin.",
        herColors: ["#0E0E12", "#FFFFFF", "#C9C9D4"],
        himColors: ["#FFFFFF", "#0E0E12", "#B8B8C8"]
      },
      {
        id: "outfit-denim",
        title: "Denim x Neutral",
        vibeNote: "Kasual, playful, cocok buat jalan santai.",
        herColors: ["#2E4A7D", "#F7F2E8", "#FFFFFF"],
        himColors: ["#1E3C66", "#FFFFFF", "#C7B9A5"]
      }
    ]
  },
  admin: {
    passcode: "1234"
  }
};
