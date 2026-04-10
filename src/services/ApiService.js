import axios from 'axios';
import { runtimeConfig} from '../config/config.js';
import FormData from 'form-data';

export class ApiService {

    static async uploadExcel(buffer) {
        const formData = new FormData();

        formData.append('file', buffer, {
            filename: 'images.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        await axios.post(runtimeConfig.api.apiImportImage, formData, {
            headers: {
                ...formData.getHeaders()
            }
        });
    }

    static async updatePageCheckpoint(id, newLastUrl) {

        await axios.post(runtimeConfig.api.apiUpdatePage, {
            id: id,
            last_image: newLastUrl
        });
    }
}
