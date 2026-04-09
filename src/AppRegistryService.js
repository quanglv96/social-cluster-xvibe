import { config } from "./config/config.js";

export class AppRegistryService {

    static async register(publicUrl) {
        const url = config.apiRegisterSever;

        console.log('📡 Registering app with backend...');

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: publicUrl
            })
        });

        if (!res.ok) {
            throw new Error(`Registry failed: ${res.status}`);
        }

        const text = await res.text(); // 🔥 FIX

        console.log('✅ Registered:', text);

        return text;
    }
}