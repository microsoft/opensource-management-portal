//
// Copyright (c) Microsoft.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

import axios from 'axios';
import fs from 'fs';
import tmp from 'tmp-promise';

export async function downloadToString(url: string, headers: Record<string, string> = {}): Promise<string> {
  const response = await axios({
    url,
    method: 'get',
    headers,
  });
  return response.data;
}

export async function downloadToTemporaryFile(
  url: string,
  headers: Record<string, string> = {}
): Promise<string> {
  const tmpFile = await tmp.file();
  const response = await axios({
    url,
    method: 'get',
    headers,
    responseType: 'stream',
  });
  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(tmpFile.path);
    const writer = response.data.pipe(writeStream);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
  return tmpFile.path;
}
