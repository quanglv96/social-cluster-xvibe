import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { config } from './config.js';

/**
 * Lấy danh sách page cần crawl
 */
export async function getPageList() {

  const res = await axios.get(config.apiListPage);

  console.log('🔎 RAW PAGE API RESPONSE:');
  console.log(res.data);

  const pages = Array.isArray(res.data)
      ? res.data
      : [res.data];   // ⭐ wrap object thành array

  return pages.map(p => ({
    id: p.id,
    lastImage: p.last_image
  }));
}


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