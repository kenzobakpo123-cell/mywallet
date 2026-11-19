// Folder mobile/ hanya TEMPLATE yang nanti disalin ke project Expo terpisah.
// Di project Next.js ini paket react-native/expo-secure-store memang tidak
// diinstall, jadi deklarasi ini hanya supaya editor tidak merah. Pada project
// Expo asli, hapus file ini dan gunakan tipe asli dari paket tersebut.
declare module "react-native";
declare module "expo-secure-store";
