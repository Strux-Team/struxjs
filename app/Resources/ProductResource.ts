import { Resource } from "struxjs";

export class ProductResource extends Resource {
    public transform(product: any) {
        return {
            id:         product.id,
            // Add fields to expose:
            // name:    product.name,
            // email:   product.email,
            created_at: product.created_at,
        };
    }
}
