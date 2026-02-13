import ExcelJS from 'exceljs';

export async function buildExcel(pageId, images, source) {

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('images');

  sheet.columns = [
    { header: 'image_url', key: 'imageUrl', width: 80 },
    { header: 'width', key: 'width', width: 15 },
    { header: 'height', key: 'height', width: 15 },
    { header: 'source', key: 'source', width: 15 }
  ];

  images.forEach(img => {
    sheet.addRow({
      ...img,
      source: source   // inject source vào từng row
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
