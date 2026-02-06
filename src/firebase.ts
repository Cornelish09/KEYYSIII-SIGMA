import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage"; // <--- TAMBAHAN PENTING

const firebaseConfig = {
  apiKey: "AIzaSyBD7vuJMvRpP1w5eugmKGd6SkQSChqeP-8",
  authDomain: "keyysii.firebaseapp.com",
  projectId: "keyysii",
  storageBucket: "keyysii.firebasestorage.app", // Pastikan ini bener (cek di console firebase lo nanti)
  messagingSenderId: "851325650271",
  appId: "1:851325650271:web:e9e3c11564351a6b4862ea",
  measurementId: "G-F4D2TYKEPG"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app); // <--- TAMBAHAN PENTING