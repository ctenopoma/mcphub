from fastapi import FastAPI, UploadFile, File
import os
import shutil

app = FastAPI(title="MyApp API", description="A sample API running in DinD")

@app.get("/")
def read_root():
    return {"message": "Hello from MyApp!"}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    os.makedirs("uploads", exist_ok=True)
    file_location = f"uploads/{file.filename}"
    with open(file_location, "wb+") as file_object:
        shutil.copyfileobj(file.file, file_object)
    return {"info": f"file '{file.filename}' saved at '{file_location}'"}
