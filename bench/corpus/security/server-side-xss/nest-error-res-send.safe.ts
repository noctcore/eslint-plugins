// @bench category=server-side-xss cwe=CWE-79 framework=nest pair=nest-error-res-send title="failed id encoded with he.encode in the error page"
// ok
import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import * as he from 'he';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':id')
  async show(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const order = await this.orders.find(id);
    if (order) {
      res.json(order);
      return;
    }
    res.status(404).send(`<h1>Order ${he.encode(id)} was not found</h1>`);
  }
}
