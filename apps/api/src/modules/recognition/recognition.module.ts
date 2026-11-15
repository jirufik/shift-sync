import { Module } from '@nestjs/common';

import { OcrService } from './ocr.service';
import { PdfService } from './pdf.service';
import { RecognitionService } from './recognition.service';

@Module({
  providers: [OcrService, PdfService, RecognitionService],
  exports: [RecognitionService, PdfService],
})
export class RecognitionModule {}
