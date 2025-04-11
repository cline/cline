import { getAuth } from "firebase/auth"
import { initializeApp } from "firebase/app"

// Firebase configuration from extension
const firebaseConfig = {
	apiKey: "AIzaSyDcXAaanNgR2_T0dq2oOl5XyKPksYHppVo",
	authDomain: "cline-bot.firebaseapp.com",
	projectId: "cline-bot",
	storageBucket: "cline-bot.firebasestorage.app",
	messagingSenderId: "364369702101",
	appId: "1:364369702101:web:0013885dcf20b43799c65c",
	measurementId: "G-MDPRELSCD1",
}
// Initialize Firebase
const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
