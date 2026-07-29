import { ResourceCollection } from "struxjs";
import { ProductResource } from "./ProductResource.js";

/**
 * ProductResourceCollection
 * Wraps an array or pagination result of Product into a formatted response.
 *
 * Usage:
 *   return new ProductResourceCollection(users);
 *   return new ProductResourceCollection(await Product.paginate(15, page));
 */
export class ProductResourceCollection extends ResourceCollection {
    constructor(data: any[] | { data: any[]; [key: string]: any }) {
        super(ProductResource, data);
    }
}
