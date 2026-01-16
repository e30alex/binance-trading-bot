import { NestFactory } from '@nestjs/core';
import * as https from 'https';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Log outbound IP for debugging
  https.get('https://api.ipify.org', (res) => {
    res.on('data', (d: Buffer) => console.log('Outbound IP:', d.toString()));
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
