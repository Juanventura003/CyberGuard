import ctypes
import os
import platform
import plistlib
import subprocess
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=512)
def read_application_metadata(executable):
    """
    Read application metadata from the installed executable.
    No hardcoded application descriptions or external API.
    """
    if not executable:
        return {}

    path = Path(executable)

    if not path.is_file():
        return {}

    system = platform.system()

    if system == "Windows":
        return _read_windows_metadata(str(path))

    if system == "Darwin":
        return _read_macos_metadata(path)

    return {}

def _read_windows_metadata(executable):
    """
    Read Windows VERSIONINFO resources using Win32 APIs.
    """
    from ctypes import wintypes

    version = ctypes.WinDLL("version", use_last_error=True)

    get_size = version.GetFileVersionInfoSizeW
    get_size.argtypes = [
        wintypes.LPCWSTR,
        ctypes.POINTER(wintypes.DWORD),
    ]
    get_size.restype = wintypes.DWORD

    get_info = version.GetFileVersionInfoW
    get_info.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
    ]
    get_info.restype = wintypes.BOOL

    query = version.VerQueryValueW
    query.argtypes = [
        ctypes.c_void_p,
        wintypes.LPCWSTR,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(wintypes.UINT),
    ]
    query.restype = wintypes.BOOL

    handle = wintypes.DWORD(0)
    size = get_size(executable, ctypes.byref(handle))

    if not size:
        return {}

    buffer = ctypes.create_string_buffer(size)

    if not get_info(executable, 0, size, buffer):
        return {}

    def query_value(subblock):
        pointer = ctypes.c_void_p()
        length = wintypes.UINT(0)

        success = query(
            buffer,
            subblock,
            ctypes.byref(pointer),
            ctypes.byref(length),
        )

        if not success or not pointer.value:
            return None

        return ctypes.wstring_at(pointer.value)

    # Read available language/codepage combinations.
    translations = []
    pointer = ctypes.c_void_p()
    length = wintypes.UINT(0)

    if query(
        buffer,
        r"\VarFileInfo\Translation",
        ctypes.byref(pointer),
        ctypes.byref(length),
    ):
        if pointer.value and length.value >= 4:
            raw = ctypes.string_at(pointer.value, length.value)

            for offset in range(0, len(raw) - 3, 4):
                language = int.from_bytes(
                    raw[offset:offset + 2], "little"
                )
                codepage = int.from_bytes(
                    raw[offset + 2:offset + 4], "little"
                )
                translations.append(
                    f"{language:04x}{codepage:04x}"
                )

    translations.extend([
        "040904b0",
        "040904e4",
    ])

    fields = {
        "product_name": "ProductName",
        "description": "FileDescription",
        "publisher": "CompanyName",
        "version": "ProductVersion",
    }

    metadata = {}

    for key, field in fields.items():
        for translation in dict.fromkeys(translations):
            value = query_value(
                f"\\StringFileInfo\\{translation}\\{field}"
            )

            if value and value.strip():
                metadata[key] = value.strip()
                break

    return metadata

def _read_macos_metadata(executable):
    """
    Find the owning .app bundle and read Info.plist.
    """
    for parent in [executable, *executable.parents]:
        if parent.suffix.lower() != ".app":
            continue

        plist_path = parent / "Contents" / "Info.plist"

        if not plist_path.is_file():
            continue

        try:
            with plist_path.open("rb") as file:
                info = plistlib.load(file)
        except (OSError, ValueError, TypeError):
            return {}

        return {
            "product_name": (
                info.get("CFBundleDisplayName")
                or info.get("CFBundleName")
            ),
            "description": info.get("NSHumanReadableCopyright"),
            "publisher": None,
            "version": (
                info.get("CFBundleShortVersionString")
                or info.get("CFBundleVersion")
            ),
        }

    return {}

def generate_process_description(name, executable):
    """
    Generate a description from actual application metadata.
    """
    metadata = read_application_metadata(executable)

    product = metadata.get("product_name")
    description = metadata.get("description")
    publisher = metadata.get("publisher")
    version = metadata.get("version")

    parts = []

    if description:
        parts.append(description)
    elif product:
        parts.append(f"{product} is an installed application.")
    else:
        parts.append(
            f"{name} is a running process. "
            "Detailed application information is unavailable."
        )

    if publisher:
        parts.append(f"Publisher listed in file metadata: {publisher}.")

    if version:
        parts.append(f"Version: {version}.")

    return " ".join(parts), bool(metadata)