import PostService from "./PostService.js";

export default class ProductService {
    constructor(private postService: PostService) { }

    findAll() {
        console.log(this.postService);
    }
}