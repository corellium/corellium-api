const A8Volume = {
    "allocate": 20,
    "partitions": [
        {
            "name": "nand",
            "block_size": 4096,
            "blocks": 3906250,
            "allow_unencrypted": true,
            "fill_1": 255
        },
        {
            "name": "nand_llb",
            "block_size": 4096,
            "blocks": 16384,
            "fill_1": 255
        },
        {
            "name": "nand_fw",
            "block_size": 4096,
            "blocks": 16384,
            "fill_1": 255
        },
        {
            "name": "nand_diag_ctrl",
            "block_size": 4096,
            "blocks": 16384,
            "fill_1": 255
        },
        {
            "name": "nand_effaceable",
            "block_size": 4096,
            "blocks": 65536,
            "fill_1": 255
        },
        {
            "name": "nand_diag_syscfg",
            "block_size": 4096,
            "blocks": 16384,
            "fill_1": 255
        },
        {
            "name": "nand_panic",
            "block_size": 4096,
            "blocks": 16384,
            "fill_1": 0
        },
        {
            "name": "nand_nvram",
            "block_size": 4096,
            "blocks": 2,
            "nvram": true
        },
        {
            "name": "bbram",
            "block_size": 4096,
            "blocks": 4,
            "fill_1": 0
        },
        {
            "name": "state",
            "block_size": 4096,
            "blocks": (((1025 + 512) * 1024 * 1024) / 4096),
            "fill_1": 0
        }
    ]
};

const A10Volume = {
    "allocate": 20,
    "partitions": [
        {
            "name": "nand",
            "block_size": 4096,
            "blocks": 3906250,
            "allow_unencrypted": true,
            "fill_1": 255
        },
        {
            "name": "nand_ctrlbits",
            "block_size": 4096,
            "blocks": 2,
            "fill_1": 255
        },
        {
            "name": "nand_effaceable",
            "block_size": 4096,
            "blocks": 1,
            "fill_1": 255
        },
        {
            "name": "nand_firmware",
            "block_size": 4096,
            "blocks": 2048,
            "fill_1": 255
        },
        {
            "name": "nand_nvram",
            "block_size": 4096,
            "blocks": 2,
            "nvram": true
        },
        {
            "name": "nand_panic",
            "block_size": 4096,
            "blocks": 256,
            "fill_1": 0
        },
        {
            "name": "nand_syscfg",
            "block_size": 4096,
            "blocks": 32,
            "fill_1": 255
        },
        {
            "name": "bbram",
            "block_size": 4096,
            "blocks": 4,
            "fill_1": 0
        },
        {
            "name": "state",
            "block_size": 4096,
            "blocks": (((1025 + 512) * 1024 * 1024) / 4096),
            "fill_1": 0
        }
    ]
};

const A8BootArgs = [
    {
        versionRange: {
            lower: {
                major: 10,
                minor: 0,
                patch: 0
            },
            upper: {
                major: 11,
                minor: 0,
                patch: 0
            }
        },

        restore: '-v nand-enable-reformat=1 rootdev=md0 rd=md0 debug=0x14e serial=3',
        normal: '-v rootdev=disk0s1 debug=0x14e serial=3 gpu=0'
    },
    {
        versionRange: {
            lower: {
                major: 11,
                minor: 0,
                patch: 0
            },
            upper: {
                major: 12,
                minor: 0,
                patch: 0
            }
        },

        restore: '-v nand-enable-reformat=1 rootdev=md0 rd=md0 debug=0x14e serial=3',
        normal: '-v rootdev=disk0s1s1 debug=0x14e serial=3 gpu=0'
    }
];

const A10BootArgs = [
    {
        versionRange: {
            lower: {
                major: 10,
                minor: 0,
                patch: 0
            },
            upper: {
                major: 11,
                minor: 0,
                patch: 0
            }
        },

        restore: '-v nand-enable-reformat=1 rootdev=md0 rd=md0 debug=0x14e serial=3 cpus=1',
        normal: '-v rootdev=disk0s1 debug=0x14e serial=3 gpu=0 cpus=1'
    },
    {
        versionRange: {
            lower: {
                major: 11,
                minor: 0,
                patch: 0
            },
            upper: {
                major: 12,
                minor: 0,
                patch: 0
            }
        },

        restore: '-v nand-enable-reformat=1 rootdev=md0 rd=md0 debug=0x14e serial=3 cpus=1',
        normal: '-v rootdev=disk0s1s1 debug=0x14e serial=3 gpu=0 cpus=1'
    }
];

const SupportedDevices = [
    {
        "flavor": "iPhone 6",
        "flavorId": "iphone6",
        "product": "iPhone7,2",
        "model": "n61ap",
        "volume": A8Volume,
        "bootargs": A8BootArgs,
        "charmd": "iphone6"
    },
    {
        "flavor": "iPhone 6 Plus",
        "flavorId": "iphone6plus",
        "product": "iPhone7,1",
        "model": "n56ap",
        "volume": A8Volume,
        "bootargs": A8BootArgs,
        "charmd": "iphone6"
    },
    {
        "flavor": "iPod touch 6",
        "flavorId": "ipodtouch6",
        "product": "iPod7,1",
        "model": "n102ap",
        "volume": A8Volume,
        "bootargs": A8BootArgs,
        "charmd": "iphone6"
    },
    {
        "flavor": "iPad mini 4",
        "flavorId": "ipadmini4",
        "product": "iPad5,2",
        "model": "j97ap",
        "volume": A8Volume,
        "bootargs": A8BootArgs,
        "charmd": "iphone6"
    },
    {
        "flavor": "iPad mini 4 Wi-Fi",
        "flavorId": "ipadmini4wifi",
        "product": "iPad5,1",
        "model": "j96ap",
        "volume": A8Volume,
        "bootargs": A8BootArgs,
        "charmd": "iphone6"
    },
    {
        "flavor": "Apple TV 4",
        "flavorId": "appletv4",
        "product": "AppleTV5,3",
        "model": "j42dap",
        "volume": A8Volume,
        "bootargs": A8BootArgs,
        "charmd": "iphone6"
    },
    {
        "flavor": "HomePod",
        "flavorId": "homepod",
        "product": "AudioAccessory1,1",
        "model": "b238aap",
        "volume": A8Volume,
        "bootargs": A8BootArgs,
        "charmd": "iphone6"
    },
    {
        "flavor": "iPhone 7",
        "flavorId": "iphone7",
        "product": "iPhone9,1",
        "model": "d10ap",
        "volume": A10Volume,
        "bootargs": A10BootArgs,
        "charmd": "iphone7"
    },
    {
        "flavor": "iPhone 7 Plus",
        "flavorId": "iphone7plus",
        "product": "iPhone9,2",
        "model": "d11ap",
        "volume": A10Volume,
        "bootargs": A10BootArgs,
        "charmd": "iphone7"
    }
];

module.exports = {
    devices: SupportedDevices,
    products: SupportedDevices.map(device => { return device['product']; })
};
