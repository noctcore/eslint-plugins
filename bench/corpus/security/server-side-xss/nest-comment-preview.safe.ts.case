// @bench category=server-side-xss cwe=CWE-79 framework=nest pair=nest-comment-preview title="posted comment passed through filterXSS first"
// ok
import { Body, Controller, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { filterXSS } from 'xss';

class PreviewDto {
  comment!: string;
}

@Controller('comments')
export class CommentsController {
  @Post('preview')
  preview(@Body() dto: PreviewDto, @Res() res: Response): void {
    res.type('html');
    res.send(`<div class="preview"><p>${filterXSS(dto.comment)}</p><small>preview only</small></div>`);
  }
}
