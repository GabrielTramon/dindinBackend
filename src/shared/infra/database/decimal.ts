import { Prisma } from '../../../generated/prisma/client';

/*
  Dinheiro é Decimal(12,2) no banco e number no domínio. Os valores do produto
  (salário, parcela, meta) ficam muito abaixo do limite de precisão do number,
  e o motor inteiro trabalha com number.
*/

export function decimalToNumber(value: Prisma.Decimal): number;
export function decimalToNumber(value: Prisma.Decimal | null): number | null;
export function decimalToNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

export function numberToDecimal(value: number): Prisma.Decimal;
export function numberToDecimal(value: number | null): Prisma.Decimal | null;
export function numberToDecimal(value: number | null): Prisma.Decimal | null {
  return value === null ? null : new Prisma.Decimal(value);
}
