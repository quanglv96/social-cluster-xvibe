import ExcelJS from 'exceljs';

export class ExcelService {

    static async buildExcel(images, source) {

        if (!Array.isArray(images)) {
            throw new Error('Invalid images array');
        }

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
                imageUrl: img.url,
                width: img.width,
                height: img.height,
                source: source
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        return buffer;
    }
}
