import axios from 'axios';
import FormData from 'form-data';
import { config } from '../config.js';
/**
 * Upload file excel lên backend
 */
export async function uploadExcel(buffer, pageId) {

  const formData = new FormData();

  formData.append(
      'file',
      buffer,
      `crawl_${pageId}.xlsx`
  );

  return axios.post(
      config.apiImportImage,
      formData,
      {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
  );
}

export async function updatePageCheckpoint(id, lastUrl) {

  await axios.post(`${config.apiUpdatePage}`, {
    last_image:lastUrl,
    id :id
  });
}