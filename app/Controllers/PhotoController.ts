import { Request, view } from "struxjs";

export class PhotoController {
    /**
     * Display a listing of the resource.
     */
    public async index() {
        return view("photo.index");
    }

    /**
     * Show the form for creating a new resource.
     */
    public async create(request: Request) {
        return view("photo.create");
    }

    /**
     * Store a newly created resource in storage.
     */
    public async store(request: Request) {
        //Logic
    }

    /**
     * Display the specified resource.
     */
    public async show(id: string) {
        return view("photo.show", { id });
    }

    /**
     * Show the form for editing the specified resource.
     */
    public async edit(id: string) {
        return view("photo.edit", { id });
    }

    /**
     * Update the specified resource in storage.
     */
    public async update(request: Request) {
        //Logic
    }

    /**
     * Remove the specified resource from storage.
     */
    public async destroy(id: string) {
        //Logic
    }
}
