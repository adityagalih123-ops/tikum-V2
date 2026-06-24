// =============================================
// FIREBASE CONFIGURATION
// Ganti dengan konfigurasi Firebase project Anda
// =============================================

const firebaseConfig = {
   apiKey: "AIzaSyBxvO_V-vuJv-5ebFgEMEDJNR8ITds0NQ4",
  authDomain: "tikum-angkringancoffe-a8c35.firebaseapp.com",
  projectId: "tikum-angkringancoffe-a8c35",
  storageBucket: "tikum-angkringancoffe-a8c35.firebasestorage.app",
  messagingSenderId: "220187399188",
  appId: "1:220187399188:web:0187924a926b4e3d198301"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Enable offline persistence
db.enablePersistence().catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('Persistence gagal: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('Persistence tidak didukung browser ini');
  }
});

